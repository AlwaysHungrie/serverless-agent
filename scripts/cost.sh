#!/usr/bin/env bash
#
# What one agent / one chat session costs in Cloudflare units.
#
# Cloudflare reports usage per account, never per agent, so a per-session number comes
# from running one session against a Worker nothing else is touching and reading the
# counters for that window. Staging is that Worker: own name, own Durable Object
# namespaces, own bucket. Where background traffic (a live Telegram webhook) shares
# the window, the per-object table below is what separates it out — the session's own
# agent and session objects are new ids, so their rows are attributable on sight.
#
#     set -a; source .cf.env; set +a
#     scripts/cost.sh 2026-09-24T10:00:00Z 2026-09-24T10:10:00Z
#
# Timestamps are UTC, as `date -u +%Y-%m-%dT%H:%M:%SZ` prints them.
#
# Every GraphQL query here is one physical line. Wrapping them across lines puts raw
# newlines inside a JSON string and the API then answers about a different, smaller
# set of groups than it does for the same query unwrapped, which silently under-reports
# rather than failing. Keep them on one line.
#
# Two API shapes to know: durableObjectsPeriodicGroups (wall time, SQLite rows) cannot
# filter on scriptName, only namespaceId, so step 1 reads the ids from the invocations
# table and step 2 feeds them back; and durableObjectsStorageGroups is account-wide
# with no script dimension, so stored bytes is not per-session and is left out.
set -euo pipefail

FROM=${1:?usage: cost.sh <fromISO8601Z> <toISO8601Z> [scriptName]}
TO=${2:?usage: cost.sh <fromISO8601Z> <toISO8601Z> [scriptName]}
SCRIPT=${3:-salt-agent-staging}
BUCKET=${R2_BUCKET:-salt-agent-files-staging}
: "${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID (source .cf.env)}"
: "${CF_API_TOKEN:?set CF_API_TOKEN (source .cf.env)}"

gql() {
  local body out
  body=$(cat)
  out=$(curl -s https://api.cloudflare.com/client/v4/graphql \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H 'content-type: application/json' --data "$body")
  if [ "$(jq -r 'if (.errors|type)=="array" and (.errors|length)>0 then "bad" else "ok" end' <<<"$out")" = bad ]; then
    echo "GraphQL error: $(jq -c '.errors' <<<"$out")" >&2
    return 1
  fi
  printf '%s' "$out"
}

Q_WORKER='query($a:String!,$s:String!,$f:Time!,$t:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:1000,filter:{scriptName:$s,datetime_geq:$f,datetime_leq:$t}){sum{requests errors subrequests}quantiles{cpuTimeP50 cpuTimeP99}}}}}'
Q_INV='query($a:String!,$s:String!,$f:Time!,$t:Time!){viewer{accounts(filter:{accountTag:$a}){durableObjectsInvocationsAdaptiveGroups(limit:1000,filter:{scriptName:$s,datetime_geq:$f,datetime_leq:$t}){dimensions{name namespaceId}sum{requests errors}}}}}'
Q_PER='query($a:String!,$ns:[String!],$f:Time!,$t:Time!){viewer{accounts(filter:{accountTag:$a}){durableObjectsPeriodicGroups(limit:1000,filter:{namespaceId_in:$ns,datetime_geq:$f,datetime_leq:$t}){dimensions{name}sum{activeTime cpuTime rowsRead rowsWritten}}}}}'
Q_R2='query($a:String!,$b:String!,$f:Time!,$t:Time!){viewer{accounts(filter:{accountTag:$a}){r2OperationsAdaptiveGroups(limit:100,filter:{bucketName:$b,datetime_geq:$f,datetime_leq:$t}){dimensions{actionType}sum{requests}}}}}'

WORKER=$(jq -n --arg q "$Q_WORKER" --arg a "$CF_ACCOUNT_ID" --arg s "$SCRIPT" --arg f "$FROM" --arg t "$TO" \
  '{query:$q,variables:{a:$a,s:$s,f:$f,t:$t}}' | gql)

INV=$(jq -n --arg q "$Q_INV" --arg a "$CF_ACCOUNT_ID" --arg s "$SCRIPT" --arg f "$FROM" --arg t "$TO" \
  '{query:$q,variables:{a:$a,s:$s,f:$f,t:$t}}' | gql)

NSIDS=$(jq -c '[.data.viewer.accounts[0].durableObjectsInvocationsAdaptiveGroups[].dimensions.namespaceId]|unique' <<<"$INV")

if [ "$NSIDS" = "[]" ]; then
  PERIODIC='{"data":{"viewer":{"accounts":[{"durableObjectsPeriodicGroups":[]}]}}}'
else
  PERIODIC=$(jq -n --arg q "$Q_PER" --arg a "$CF_ACCOUNT_ID" --argjson ns "$NSIDS" --arg f "$FROM" --arg t "$TO" \
    '{query:$q,variables:{a:$a,ns:$ns,f:$f,t:$t}}' | gql)
fi

R2=$(jq -n --arg q "$Q_R2" --arg a "$CF_ACCOUNT_ID" --arg b "$BUCKET" --arg f "$FROM" --arg t "$TO" \
  '{query:$q,variables:{a:$a,b:$b,f:$f,t:$t}}' | gql)

jq -n --arg from "$FROM" --arg to "$TO" \
   --argjson w "$WORKER" --argjson i "$INV" --argjson p "$PERIODIC" --argjson r "$R2" '
  ($w.data.viewer.accounts[0].workersInvocationsAdaptive[0]) as $wk
| ($i.data.viewer.accounts[0].durableObjectsInvocationsAdaptiveGroups) as $inv
| ($p.data.viewer.accounts[0].durableObjectsPeriodicGroups) as $per
| ($r.data.viewer.accounts[0].r2OperationsAdaptiveGroups) as $r2
| ([$inv[]|{key:.dimensions.name,value:.sum.requests}]|from_entries) as $reqby
| {
  window: {from:$from, to:$to},
  worker: {
    requests: ($wk.sum.requests // 0),
    errors: ($wk.sum.errors // 0),
    subrequests: ($wk.sum.subrequests // 0),
    cpu_ms_p50: (($wk.quantiles.cpuTimeP50 // 0)/1000),
    cpu_ms_p99: (($wk.quantiles.cpuTimeP99 // 0)/1000)
  },
  # One row per Durable Object instance that was awake in the window. `object` is the
  # instance name: a bare id is an agent, `<agent>~<id>` is one of its chat sessions,
  # `root` is the directory/registry singleton, and anything with `tg-` in it is the
  # Telegram side rather than the session under test.
  objects: [ $per[] | {
    object: .dimensions.name,
    do_requests: ($reqby[.dimensions.name] // 0),
    rows_read: .sum.rowsRead,
    rows_written: .sum.rowsWritten,
    active_s: (.sum.activeTime/1000000),
    cpu_ms: (.sum.cpuTime/1000)
  } ] | sort_by(-.rows_read),
  totals: {
    do_requests: ([$inv[].sum.requests]|add // 0),
    rows_read: ([$per[].sum.rowsRead]|add // 0),
    rows_written: ([$per[].sum.rowsWritten]|add // 0),
    active_s: (([$per[].sum.activeTime]|add // 0)/1000000),
    # Durable Objects bill wall-clock time at 128 MB, so GB-s is seconds x 0.128.
    active_gb_s: ((([$per[].sum.activeTime]|add // 0)/1000000)*0.128)
  },
  r2: ([$r2[]|{key:.dimensions.actionType,value:.sum.requests}]|from_entries)
}
| .usd = {
    # Paid-plan rates, Sept 2026. The free plan bills none of this; the dollar figure
    # says what the window would cost once past the free tier.
    worker_requests: (.worker.requests*0.30/1e6),
    do_requests: (.totals.do_requests*0.15/1e6),
    do_duration: (.totals.active_gb_s*12.50/1e6),
    rows_written: (.totals.rows_written*1.00/1e6),
    rows_read: (.totals.rows_read*0.001/1e6)
  }
| .usd.total = ([.usd[]]|add)
| .free_tier_headroom_per_day = {
    # Smallest of these is the real ceiling on sessions per day. Based on window
    # totals, so it counts background traffic too; divide using the per-object rows
    # above for the session alone.
    by_worker_requests: (if .worker.requests>0 then (100000/.worker.requests|floor) else null end),
    by_do_requests: (if .totals.do_requests>0 then (100000/.totals.do_requests|floor) else null end),
    by_rows_written: (if .totals.rows_written>0 then (100000/.totals.rows_written|floor) else null end),
    by_rows_read: (if .totals.rows_read>0 then (1000000/.totals.rows_read|floor) else null end)
  }
'
