# agent

A Cloudflare Agent built on the [Agents SDK](https://developers.cloudflare.com/agents/).
**One Durable Object instance = one agent session.** The session id is the instance name
in the URL, so `/agents/session-agent/alice` and `/agents/session-agent/bob` are two
isolated DOs with their own SQLite database and message history.

The model is served through OpenRouter: `deepseek/deepseek-v4-flash`, overridable via the
`MODEL` var in `wrangler.jsonc`.

## Run locally

```bash
cp .dev.vars.example .dev.vars   # then put your OpenRouter key in it
pnpm install
pnpm dev                          # wrangler dev on http://localhost:8787
```

`.dev.vars` is gitignored and holds `OPENROUTER_API_KEY`.

## Send a message

```bash
node scripts/chat.mjs my-session "what is a durable object?"
```

Or with curl:

```bash
curl -X POST http://localhost:8787/agents/session-agent/my-session/chat \
  -H 'content-type: application/json' \
  -d '{"message":"what is a durable object?"}'
```

## Routes

| Route | What it does |
|---|---|
| `POST /agents/session-agent/:id/chat` | Send a message, get a reply |
| `POST /agents/session-agent/:id/stream` | Send a message, get an SSE token stream |
| `GET  /agents/session-agent/:id/messages` | Transcript, with per-message tokens and cost |
| `GET  /agents/session-agent/:id/summary` | Message count and total LLM spend |
| `POST /agents/session-agent/:id/reset` | Wipe the session |
| `GET\|POST /api/sessions` | List / create sessions |
| `PATCH\|DELETE /api/sessions/:id` | Rename / delete a session |

Durable Object namespaces cannot be enumerated — you can address an instance by name but
not ask which instances exist — so the session list lives in one well-known
`SessionRegistry` object while each session's transcript lives in its own `SessionAgent`.

## Costs

Token cost is reported per message, because OpenRouter returns it in the response.

**Cloudflare's costs are deliberately not measured here.** Counting your own requests and
wall clock from inside a Durable Object gives the wrong answer and costs a row write per
request to maintain. Cloudflare's GraphQL Analytics API reports the units it actually
bills.

See [docs/cloudflare-durable-object-costs.md](../docs/cloudflare-durable-object-costs.md)
for what each charge means, the exact queries and field names, and the traps — the
key-value field names that silently return zero on SQLite-backed objects being the worst.
