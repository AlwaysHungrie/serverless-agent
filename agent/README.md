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
| `GET  /agents/session-agent/:id/history` | Full conversation from the DO's SQLite |
| `GET  /agents/session-agent/:id/metrics` | Resource usage + cost estimate |
| `POST /agents/session-agent/:id/reset` | Wipe the session |

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

Two caveats on the numbers:

1. They are **marginal** rates. On the $5/month Paid plan the included allowances above
   come first, so a handful of sessions genuinely costs $0 on top of the base plan. The
   `capacity` field says how many sessions of this size fit inside the allowances and
   which limit binds first.
2. Duration measured locally is a **lower bound**. In production a DO stays resident for
   a short grace period after a request, and stays alive continuously while a WebSocket
   is open, so real billed GB-s will be higher than a request-only measurement.

At these rates the LLM tokens dominate: one short DeepSeek Flash turn costs on the order
of $10⁻⁵, while the Durable Object time and storage behind it cost on the order of $10⁻⁸.
