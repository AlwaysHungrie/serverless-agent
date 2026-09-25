# What a Durable Object agent costs, and how to find out

Findings from instrumenting this project, deployed on Cloudflare with one Durable
Object per chat session and DeepSeek V4 Flash behind OpenRouter.

---

## Summary: roughly $0.00005 per message

For a short exchange (~25 tokens in, ~130 out, ~4 seconds of streaming):

|                                                       | Per message     | Share      |
| ----------------------------------------------------- | --------------- | ---------- |
| **LLM tokens** (OpenRouter, DeepSeek V4 Flash)        | ~$0.000040      | ~78%       |
| **DO duration** (~4s awake × 128 MB = 0.5 GB-s)       | ~$0.0000063     | ~12%       |
| **SQLite rows written** (~4 rows — but see below)     | ~$0.0000040     | ~8%        |
| **Requests** (~3 calls, billed by both Worker and DO) | ~$0.0000014     | ~3%        |
| **SQLite rows read** (~20 rows)                       | ~$0.00000002    | negligible |
| **Storage** (~48 KB, charged monthly not per message) | ~$0.00001/month | negligible |
| **Total**                                             | **~$0.00005**   |            |

**About 20,000 messages per dollar.** The model costs roughly four times the
infrastructure, and most of the infrastructure cost is the Durable Object sitting awake
waiting for the model to finish streaming.

On the **Free plan you pay nothing at all** — there is no overage, the object simply
stops serving past the daily caps (100,000 requests, 13,000 GB-s, 100,000 rows written,
5,000,000 rows read per day). At ~4 seconds per message that is roughly 26,000 messages a
day before anything cuts out.

---

## How Cloudflare calculates the bill

Six charges, five of them on the Durable Object and one on the Worker in front.

### 1. Requests — $0.15 per million

Every call into the object: an HTTP request, an RPC call, a WebSocket message, or an
alarm firing. Incoming WebSocket messages are billed at a 20:1 ratio.

### 2. Duration — $12.50 per million GB-seconds

The one that surprises people. A Durable Object is billed for a **fixed 128 MB of
memory** for as long as it is _active_, no matter how little it actually uses. One second
awake costs 0.125 GB-s.

Active means:

- running JavaScript, **and**
- **waiting on a subrequest** — the seconds spent waiting for the model to stream tokens
  are billed, even though the object is doing nothing, **and**
- any time a non-hibernatable WebSocket is open. `accept()` bills for the socket's entire
  lifetime; the WebSocket Hibernation API avoids this.
- an outbound `connect()` keeps it resident for up to 15 minutes.

Not active: idle and eligible for hibernation. Billing stops **immediately** when the
object goes idle, before the runtime actually hibernates it. There is no billed grace
period, so an open browser tab costs nothing.

This is why streaming dominates: a slow model is billed twice, once in tokens and once in
the seconds your object spends waiting for it.

### 3. SQLite rows written — $1.00 per million

Every row inserted, updated **or deleted**, and every index entry those statements touch.
An insert into a table with one index bills two rows, and deleting that row later bills
two more — so a row that is written and then swept costs four. **A thousand times more
expensive than reads**, which makes write-heavy patterns the thing to watch, and indexes
on high-churn tables the first place to look when the number is higher than expected.
See [Where rows written actually come from](#where-rows-written-actually-come-from).

### 4. SQLite rows read — $0.001 per million

Effectively free. Reading a whole transcript on every page load costs nothing.

### 5. Stored data — $0.20 per GB-month

A rate, not accumulated spend. Charged for holding bytes, whether or not you touch them.

### 6. Worker requests — $0.30 per million

The Worker routing to the object bills separately from the object itself. The same call
appears twice in a breakdown: once as a Worker request, once as a DO request.

### Not billed separately

**CPU time.** It is reported in analytics and is useful for spotting hot code, but it is
already inside duration. Counting it again double-counts.

### Plan allowances

|                | Free              | Paid ($5/month)                     |
| -------------- | ----------------- | ----------------------------------- |
| DO requests    | 100,000/day       | 1,000,000/month, then $0.15/M       |
| DO duration    | 13,000 GB-s/day   | 400,000 GB-s/month, then $12.50/M   |
| Rows written   | 100,000/day       | 50,000,000/month, then $1.00/M      |
| Rows read      | 5,000,000/day     | 25,000,000,000/month, then $0.001/M |
| Storage        | 5 GB total        | 5 GB, then $0.20/GB-month           |
| Past the limit | **stops serving** | billed as overage                   |

---

## How to calculate it yourself

Do **not** instrument your own code — see the traps below. Ask Cloudflare, through the
GraphQL Analytics API at `https://api.cloudflare.com/client/v4/graphql`. A token with
**Account · Account Analytics · Read** is enough.

### The datasets and fields that matter

```graphql
query ActualUsage(
  $account: String!
  $since: Time!
  $sinceDate: Date!
  $objectId: String
) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      # Requests and errors. Filterable per object.
      durableObjectsInvocationsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $since, objectId: $objectId }
      ) {
        dimensions {
          namespaceId
          scriptName
        }
        sum {
          requests
          errors
        }
        avg {
          sampleInterval
        }
      }

      # Duration, CPU, and SQLite row counts. Filterable per object.
      durableObjectsPeriodicGroups(
        limit: 10000
        filter: { datetime_geq: $since, objectId: $objectId }
      ) {
        sum {
          activeTime
          cpuTime
          subrequests
          rowsRead
          rowsWritten
        }
        avg {
          sampleInterval
        }
      }

      # Stored bytes for SQLite-backed objects. Per namespace and per day only.
      durableObjectsSqlStorageGroups(
        limit: 1000
        filter: { date_geq: $sinceDate }
      ) {
        dimensions {
          date
          namespaceId
        }
        max {
          storedBytes
        }
      }
    }
  }
}
```

### Turning units into dollars

```
gbSeconds       = (activeTime_microseconds / 1e6) * 0.125
durationUsd     = (gbSeconds   / 1e6) * 12.50
doRequestsUsd   = (requests    / 1e6) * 0.15
workerReqUsd    = (requests    / 1e6) * 0.30
rowsWrittenUsd  = (rowsWritten / 1e6) * 1.00
rowsReadUsd     = (rowsRead    / 1e6) * 0.001
storageUsdMonth = (storedBytes / 1e9) * 0.20
```

`activeTime` is in **microseconds**. `storedBytes` is a daily snapshot — take the most
recent day, never a sum across days.

### Mapping a session to an object

`objectId` is the Durable Object's hex id, which you get from
`env.MyNamespace.idFromName(name).toString()`. Record it when the session is created;
you cannot recover it from analytics alone, and namespaces are not enumerable.

---

## Traps, all of which cost me a wrong answer first

### 1. Instrumenting yourself is wrong and expensive

The first version counted its own requests, wall clock and rows, then priced them. Two
problems. It was **wrong**: handler wall-clock is not residency, concurrent requests
double-count, and SQL issued by the framework never passes through your own wrapper, so
row counts are a floor. And it was **expensive**: six counter upserts per request meant
every page refresh wrote ~12 rows, so the meter cost several times more than the work it
measured — $1.2e-5 per refresh, against ~$9e-7 of real work. Collapsing it to one row
write per request cut that 4×, and deleting it entirely was better still.

There is a deeper version of this: **reading the bill changed the bill**, because the
metrics endpoint wrote its own counters.

### 2. The KV field names silently return zero on SQLite

Durable Objects have two storage backends, and the analytics schema kept the older
key-value names alongside the SQLite ones:

| Looks right         | Actually for      | On a SQLite object |
| ------------------- | ----------------- | ------------------ |
| `storageReadUnits`  | key-value backend | always `0`         |
| `storageWriteUnits` | key-value backend | always `0`         |
| `rowsRead`          | SQLite            | the real number    |
| `rowsWritten`       | SQLite            | the real number    |

The KV fields **do not error**. They return `0`, which reads as "this is free" rather
than "you asked the wrong question". Rows written was reported as $0 for a while when it
was in fact the largest Cloudflare line item.

### 3. The same trap again, at the dataset level

| Dataset                          | Covers            | On a SQLite object         |
| -------------------------------- | ----------------- | -------------------------- |
| `durableObjectsStorageGroups`    | key-value backend | returns **no rows at all** |
| `durableObjectsSqlStorageGroups` | SQLite            | the real bytes             |

An empty array is not a zero. It means "wrong dataset" or "no snapshot yet", and the two
are indistinguishable without checking a namespace you know has data.

### 4. Unfiltered queries return other people's numbers

`durableObjectsSqlStorageGroups` has a `namespaceId` dimension but **no `objectId`**. An
unfiltered query returned 49,152 bytes and I reported it as this project's storage. It
belonged to an unrelated, older namespace on the same account — zero requests, data
predating the project. The coincidence that hid it: 48 KB is SQLite's minimum allocation,
so the local database was exactly the same size.

Always filter storage by the `namespaceId` your own invocations report.

### 5. Introspection is disabled

`__type` returns `null`. The documentation does not enumerate the fields either. Every
field name here was confirmed by sending a query with one candidate field and checking
whether it errored. If you are guessing field names, verify them this way rather than
trusting a blog post.

### 6. Cloudflare's own numbers are sampled

Both adaptive datasets expose `avg { sampleInterval }`. Sums must be scaled by it. "Real"
here means _authoritative for billing_, not _exact_.

### 7. Analytics lag, so per-message cost is impossible

The datasets trail by minutes. A per-message Cloudflare figure cannot exist — by the time
the number is available, the message is long gone. Only per-session or per-day totals are
honest. Token cost is different: OpenRouter returns it in the response, so that one is
exact and immediate.

### 8. Deploy first, and note what deploying does not prove

Analytics only exist for a deployed Worker; `wrangler dev` traffic is never metered.
And a successful deploy does **not** prove you are on a paid plan — SQLite-backed
Durable Objects run on the Free plan too.

### 9. Query windows are capped

The API refuses ranges wider than **4 weeks 4 days**.

---

## Where rows written actually come from

Measured 2026-09-25 against three days of real traffic. The `~4 rows per message` in the
summary above was the figure before resumable streaming landed; **the real rate is closer
to 16 rows written per turn**, and almost none of them are written by this project's own
code.

### This project's own writes are small

`SessionAgent` declares five tables and **no indexes** (`agent/src/agent.ts`,
`SESSION_AGENT_MIGRATIONS`): `attachments`, `message_files`, `message_text`, `usage`,
`file_cache`. A turn touches a handful of rows across them. `SessionRegistry` has more
tables and three indexes, but it is written to once per session, not once per turn.

### The stream buffer is the write-heavy part

The `agents` SDK persists every model reply to SQLite as it streams, so a dropped
connection or an evicted object can replay it. In
`node_modules/agents/dist/chat/index.js`:

- Each SSE delta from the model is pushed onto an in-memory array, `_chunkBuffer`.
- The buffer flushes to `cf_ai_chat_stream_chunks` on whichever comes first: 10 buffered
  chunks (`CHUNK_BUFFER_SIZE`), 100 chunks (`CHUNK_BUFFER_MAX_SIZE`), a segment that
  would exceed 512 KB (`SEGMENT_MAX_BYTES`), or a lifecycle call — `start`, `complete`,
  `markError`, replay.
- One flush writes **one** row whose body is a JSON array of the buffered deltas. That
  collapse is deliberate and is the reason the rate is 16 rows a turn rather than several
  hundred.
- `cf_ai_chat_stream_chunks` carries an index, so each flush bills two rows.
- `cf_ai_chat_stream_metadata` takes an insert, one or more updates, and a delete per
  stream.
- A sweep alarm deletes finished chunk rows. Those deletes bill as writes, so every
  flushed segment is paid for twice.

`@cloudflare/think` adds six more tables of its own with six indexes
(`cf_think_action_ledger`, `cf_think_submissions`, `cf_think_scheduled_tasks` and so on),
which carry the same index multiplier on anything they record.

### What the numbers looked like

Staging (`salt-agent-staging`), per UTC day, from `scripts/cost.sh`:

| Day (UTC)        | Worker req | DO req | Rows read | Rows written | DO GB-s |
| ---------------- | ---------- | ------ | --------- | ------------ | ------- |
| 2026-09-22       | 0          | 0      | 0         | 0            | 0       |
| 2026-09-23       | 186        | 939    | 16,024    | 2,850        | 23.6    |
| 2026-09-24       | 1,192      | 4,905  | 95,165    | 8,437        | 112.3   |
| 2026-09-25 (02h) | 227        | 854    | 25,681    | 1,658        | 19.6    |

On the busiest of those days the per-object table attributes ~469 requests and ~7,446
rows written to session objects, the remainder to the agent-root and registry singletons.
That is the ~16 rows per turn figure. Staging carried essentially all of it — production
served 3 requests the same day.

Against the Free plan's daily caps, rows written is the tightest axis and still has an
order of magnitude of headroom:

| Cap               | Used (09-24) | Limit     | Share    |
| ----------------- | ------------ | --------- | -------- |
| Rows written      | 8,437        | 100,000   | **8.4%** |
| DO requests       | 4,905        | 100,000   | 4.9%     |
| Rows read         | 95,165       | 5,000,000 | 1.9%     |
| Worker requests   | 1,192        | 100,000   | 1.2%     |
| DO duration       | 112 GB-s     | 13,000    | 0.9%     |

At paid rates the whole day was $0.011, of which rows written was $0.008 — the largest
single line item, and still under a cent.

### The lever, and why not to pull it

Raising `CHUNK_BUFFER_SIZE` buffers more deltas per row and cuts rows written roughly in
proportion. The cost is what happens when the object is evicted mid-generation.

The buffer is plain memory; SQLite survives hibernation and eviction, memory does not.
Three cases:

- **Normal turn.** Nothing at risk. `complete()` flushes before marking the stream
  completed, so the buffer always drains.
- **Client reconnects mid-stream.** Nothing lost. The reader is still alive, so replay
  sends the flushed rows and live deltas continue from memory.
- **Object evicted mid-generation.** The buffer is gone, and the upstream request to
  OpenRouter dies with it, so the turn is truncated. On the next open the stream is
  orphaned: the SDK replays the chunk rows it finds and sends `done`. The reply the user
  keeps is whatever had been flushed. The unflushed tail is gone for good.

Only that third case is affected. At the default of 10 the loss is at most 9 deltas, a
few words. At 50 it would be at most 49, a sentence or two off a reply that was being
truncated anyway.

Not worth changing at present usage. The constant lives in `node_modules`, so it would
mean patching or forking `agents` — a dependency-pinning burden in exchange for
eight-tenths of a cent a day. Revisit if rows written passes roughly half the 100,000
daily cap.

---

## Sources

- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/durable-objects/observability/graphql-analytics/
- https://developers.cloudflare.com/analytics/graphql-api/
