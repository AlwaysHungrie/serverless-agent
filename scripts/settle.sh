#!/usr/bin/env bash
#
# Read a window's counters repeatedly until they stop changing.
#
# The analytics API backfills for several minutes after a window closes, and it does
# not say so: a query answered two minutes in returns a smaller, complete-looking
# number, and two such reads can agree with each other and still both be wrong. The
# only safe reading is one that repeats unchanged after a further wait.
#
#     scripts/settle.sh <fromISO8601Z> <toISO8601Z> [scriptName]
#
# Polls every 90s and stops once two consecutive reads match, or after 20 tries.
set -euo pipefail
FROM=${1:?usage: settle.sh <from> <to> [script]}
TO=${2:?usage: settle.sh <from> <to> [script]}
SCRIPT=${3:-salt-agent-staging}
HERE=$(cd "$(dirname "$0")" && pwd)

prev=""
for i in $(seq 1 20); do
  cur=$("$HERE/cost.sh" "$FROM" "$TO" "$SCRIPT")
  key=$(jq -c '{w:.worker.requests,do:.totals.do_requests,r:.totals.rows_read,wr:.totals.rows_written,n:(.objects|length)}' <<<"$cur")
  echo "try $i: $key"
  if [ "$key" = "$prev" ]; then
    echo "STABLE after $i reads"
    jq -c '{window:.window,worker:.worker.requests,objects:[.objects[]|{object,do_requests,rows_read,rows_written,active_s}],totals:.totals,usd:.usd}' <<<"$cur"
    exit 0
  fi
  prev=$key
  sleep 90
done
echo "NOT STABLE after 20 reads - last value above" >&2
exit 1
