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
- **Header** — the model, message count, tokens, and the LLM spend for that session.
- **Each assistant message** — tokens in and out, dollar cost, and model latency.
- **Attach** — files, images or audio, when the matching capability is on.
- **Stop** — cancels the stream. The partial reply is kept, along with the tokens
  OpenRouter already billed for, and the Durable Object stops accruing duration.

Two pages sit behind the buttons at the bottom of the sidebar:

- **Settings** — how the agent talks: model, custom instructions, reasoning effort,
  temperature, reply cap, context window, auto-titling.
- **Capabilities** — what the agent can do: web search, reading a URL, file ingest, image
  input, image generation, audio input, scheduled tasks, memory. Each is off by default,
  and the ones needing a key say so. See [agent/README.md](agent/README.md#capabilities).

The default model is `deepseek/deepseek-v4-flash` on OpenRouter, set by the `MODEL` var in
`agent/wrangler.jsonc` and overridable in Settings. Image input needs a multimodal model.

## Costs

The app shows LLM cost only, which OpenRouter reports exactly per call. Cloudflare's
costs are not shown: they cannot be measured honestly from inside the object, and their
analytics lag by minutes.

[docs/cloudflare-durable-object-costs.md](docs/cloudflare-durable-object-costs.md) has
the full picture — roughly **$0.00005 per message**, about 78% of it tokens and most of
the rest the Durable Object sitting awake waiting for the model. It also documents how to
query the real numbers, and the traps involved.
