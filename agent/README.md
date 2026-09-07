# agent

A Cloudflare Agent built on the [Agents SDK](https://developers.cloudflare.com/agents/).
**One Durable Object instance = one agent session.** The session id is the instance name
in the URL, so `/agents/session-agent/alice` and `/agents/session-agent/bob` are two
isolated DOs with their own SQLite database, message history, and usage counters.

The model is served through OpenRouter: `deepseek/deepseek-v4-flash`
($0.089/M input, $0.177/M output tokens), overridable via the `MODEL` var in
`wrangler.jsonc`.

## Run locally

```bash
cp .dev.vars.example .dev.vars   # then put your OpenRouter key in it
pnpm install
pnpm dev                          # wrangler dev, default http://localhost:8787
```

`.dev.vars` is gitignored and holds `OPENROUTER_API_KEY`.

## Send a message

```bash
node scripts/chat.mjs my-session "what is a durable object?"
```

Or with plain curl:

```bash
curl -X POST http://localhost:8787/agents/session-agent/my-session/chat \
  -H 'content-type: application/json' \
  -d '{"message":"what is a durable object?"}'
```

Other routes, all scoped to one session:

| Route | What it does |
|---|---|
| `POST /agents/session-agent/:id/chat` | Send a message, get a reply |
| `POST /agents/session-agent/:id/stream` | Send a message, get an SSE token stream |
| `GET  /agents/session-agent/:id/messages` | Full conversation with per-message tokens and cost |
| `GET  /agents/session-agent/:id/metrics` | Resource usage + cost estimate |
| `POST /agents/session-agent/:id/reset` | Wipe the session |
| `GET|POST /api/sessions` | List / create sessions |
| `PATCH|DELETE /api/sessions/:id` | Rename / delete a session |

Durable Object namespaces cannot be enumerated — you can address an instance by name but
not ask which instances exist — so the session list lives in one well-known
`SessionRegistry` object while each session's transcript lives in its own `SessionAgent`.

If port 8787 is taken, run `pnpm dev --port 8799` and point the CLI at it with
`AGENT_URL=http://localhost:8799`.

## Seeing what it consumes

Every response carries a `_meta.request` block with that turn's numbers, and
`scripts/chat.mjs` prints the running totals after each message:

- **DO requests** — billed per request into the object.
- **DO wall clock (ms)** — how long this Durable Object has been alive in memory,
  accumulated across hibernations. This is what Cloudflare bills duration on.
- **DO handler active (ms)** — time spent inside the request handler, a subset of the above.
- **DO GB-seconds** — wall clock × 128 MB, the fixed memory a DO is billed at.
- **SQLite rows read / written** — counted from the `rowsRead`/`rowsWritten` on each
  query cursor, including the metering writes themselves.
- **SQLite bytes stored** — `ctx.storage.sql.databaseSize` for this session.
- **Tokens** — prompt and completion, from OpenRouter's usage block.

## Costs

`scripts/chat.mjs ... --metrics` prices those units at Cloudflare's published rates
(Workers Paid plan, DO SQLite backend):

| Unit | Included per month | Rate beyond |
|---|---|---|
| DO requests | 1,000,000 | $0.15 / million |
| DO duration | 400,000 GB-s | $12.50 / million GB-s |
| SQLite rows read | 25 billion | $0.001 / million |
| SQLite rows written | 50 million | $1.00 / million |
| Stored data | 5 GB | $0.20 / GB-month |
| Worker requests | 10,000,000 | $0.30 / million |

### How Durable Object duration actually works

This is the part that decides the bill, and it is easy to get wrong:

- A DO is billed for **128 MB of memory regardless of what it uses**, for as long as it
  is *active*. Active means running JavaScript **or waiting on a subrequest** — so the
  seconds spent waiting for OpenRouter to produce tokens are billed duration, even
  though the object is doing nothing.
- An idle object that qualifies for hibernation **stops accruing duration immediately**,
  before the runtime actually hibernates it. There is no billed grace period.
- Calling `accept()` on a WebSocket bills duration for the **entire** time that socket is
  connected. The WebSocket Hibernation API avoids this; this project uses plain HTTP and
  SSE, so an idle session costs nothing but storage.
- An outbound `connect()` or outbound WebSocket keeps the object resident, and billed,
  for up to 15 minutes.
- "Requests" means HTTP requests, RPC sessions, WebSocket messages, and alarm
  invocations. Incoming WebSocket messages are billed at a 20:1 ratio.

The practical consequence: **streaming is the expensive part**. A 3-second reply is
3 seconds x 128 MB = 0.375 GB-s of billed duration, whether the tokens arrive fast or
slow. Everything else is noise, and an idle session costs only its stored bytes.

One more caveat: the prices reported are **marginal** rates. On the $5/month Paid plan
the included allowances above come first, so a handful of sessions genuinely costs $0 on
top of the base plan. The `capacity` field says how many sessions of this size fit inside
the allowances and which limit binds first.

At these rates the LLM tokens still dominate: one short DeepSeek Flash turn costs on the
order of $10⁻⁵, while the Durable Object time behind it costs on the order of $10⁻⁶.
