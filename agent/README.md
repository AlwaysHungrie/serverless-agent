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
| `GET\|POST /agents/session-agent/:id/files` | List pending attachments / upload one |
| `GET\|DELETE /agents/session-agent/:id/files/:fileId` | Image bytes / drop a pending attachment |
| `GET /agents/session-agent/:id/tasks` | Tasks this session scheduled |
| `DELETE /agents/session-agent/:id/tasks/:taskId` | Cancel one |
| `GET\|POST /api/sessions` | List / create sessions |
| `PATCH\|DELETE /api/sessions/:id` | Rename / delete a session |
| `GET\|PATCH /api/config` | Settings, capabilities and their metadata |

Durable Object namespaces cannot be enumerated — you can address an instance by name but
not ask which instances exist — so the session list lives in one well-known
`SessionRegistry` object while each session's transcript lives in its own `SessionAgent`.

## Capabilities

Capabilities are what the agent can *do* beyond writing text. Each one is off by default
and switched on under **Capabilities** in the frontend; the metadata in
[`src/capabilities.ts`](src/capabilities.ts) is what that page renders, so a new
capability needs no frontend change.

| Capability | Kind | Needs | Tools |
|---|---|---|---|
| Web search | tool | Brave Search API key | `web_search` |
| Read a URL | tool | — | `fetch_url` |
| File ingest | input | — | — |
| Image input | input | a multimodal model | — |
| Image generation | tool | an OpenRouter image model | `generate_image` |
| Audio input | input | an OpenAI-compatible transcription endpoint + key | — |
| Scheduled tasks | tool | — | `schedule_task`, `list_scheduled_tasks`, `cancel_scheduled_task` |
| Memory | tool | — | `remember`, `recall` |

**Tool capabilities** hand the model functions it may call. A turn runs up to six tool
rounds — call, run, feed the results back — before it must answer, on both the streaming
and non-streaming paths. **Input capabilities** change what a turn may carry in: text
files are inlined into the message, images become `image_url` parts, and audio is
transcribed once on upload so the model only ever sees text.

Memory is app-wide rather than per session: a fact worth keeping ("I use pnpm") is worth
keeping in the next session too. Recent memories are injected into the system prompt, so
the model can use what it knows without spending a round trip to discover that it knows
it.

Scheduled tasks use the Agents SDK's own scheduling (`schedule`/`getSchedules`), so they
survive eviction. A scheduled turn writes into the transcript like any other, and bills
like any other: the object wakes up to run it.

**API keys are stored in the registry's SQLite in plain text.** They are redacted on the
way out — a saved key reads back as `••••••••`, and sending that mask back means "leave
it alone" — but anyone with access to the Durable Object can read them. Move them to
Worker secrets or an encrypted store before this handles anyone else's keys.

## Costs

Token cost is reported per message, because OpenRouter returns it in the response.

**Cloudflare's costs are deliberately not measured here.** Counting your own requests and
wall clock from inside a Durable Object gives the wrong answer and costs a row write per
request to maintain. Cloudflare's GraphQL Analytics API reports the units it actually
bills.

See [docs/cloudflare-durable-object-costs.md](../docs/cloudflare-durable-object-costs.md)
for what each charge means, the exact queries and field names, and the traps — the
key-value field names that silently return zero on SQLite-backed objects being the worst.
