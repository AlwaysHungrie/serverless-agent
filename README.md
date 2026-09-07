# serverless-agent

A chat agent that runs as a Cloudflare Durable Object — one DO per session — with a
Next.js frontend that shows what every message costs, in tokens and in Cloudflare
resources, as it streams.

```
agent/      Cloudflare Worker + Durable Objects (the agent itself)
frontend/   Next.js app (AI SDK useChat, streaming, cost display)
```

## Run it

Two terminals.

```bash
# 1. the agent
cd agent && pnpm install && pnpm dev          # http://localhost:8787
```

`agent/.dev.vars` holds `OPENROUTER_API_KEY` and is gitignored.

```bash
# 2. the frontend
cd frontend && pnpm install && pnpm dev       # http://localhost:3000
```

`frontend/.env.local` points at the worker via `AGENT_URL`. The frontend never talks to
the worker from the browser — every call goes through a Next route handler, so there is
no CORS and no key exposure.

## What the UI shows

- **Left sidebar** — every session. Each one is a separate Durable Object with its own
  SQLite database. Creating a session registers it; deleting one wipes its storage.
- **Header** — the session's running **LLM cost** and **Cloudflare cost**, plus a
  breakdown of duration, requests, rows read/written and storage, and how many sessions
  of this size fit free inside the Workers Paid plan.
- **Each assistant message** — tokens in/out, dollar cost, model latency, how long the
  Durable Object stayed active for that turn, and rows written.
- **Stop** — cancels the stream. The partial reply is kept, along with the tokens
  OpenRouter already billed for, and the Durable Object stops accruing duration.

The model is `deepseek/deepseek-v4-flash` on OpenRouter, set by the `MODEL` var in
`agent/wrangler.jsonc`.

## Where the money goes

`agent/README.md` has the full breakdown, but the short version: a Durable Object is
billed for 128 MB of memory for as long as it is active, and *waiting on the model
counts as active*. A three-second reply costs three seconds of duration. An idle session
hibernates and costs nothing but its stored bytes. Token cost still dominates by about an
order of magnitude.
