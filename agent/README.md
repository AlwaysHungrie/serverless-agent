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

`.dev.vars` is gitignored and holds `OPENROUTER_API_KEY`. That key is only a fallback:
an agent with a key of its own — pasted under **Settings** — bills its own model calls
there, so one agent's spend and rate limits never land on another's.

Attachment bytes (images, voice-note clips) live in R2, not in the session's SQLite.
Create the bucket once before deploying — `wrangler dev` simulates it locally:

```bash
wrangler r2 bucket create serverless-agent-files
```

Objects are keyed `<session-id>/<attachment-id>`, and a session reset or delete drops
them. Rows written before the move still carry an inline data URL and are served from
there.

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
| `GET  /agents/session-agent/:id/messages` | One page of transcript, newest last, with per-message tokens and cost. `?limit` (default 30, max 200) and `?before=<message id>` walk backwards |
| `GET  /agents/session-agent/:id/summary` | Message count and total LLM spend |
| `POST /agents/session-agent/:id/reset` | Wipe the session |
| `GET\|POST /agents/session-agent/:id/files` | List pending attachments / upload one |
| `GET\|DELETE /agents/session-agent/:id/files/:fileId` | Image bytes / drop a pending attachment |
| `GET /agents/session-agent/:id/tasks` | Tasks this session scheduled |
| `DELETE /agents/session-agent/:id/tasks/:taskId` | Cancel one |
| `GET\|POST /api/agents` | List / create agents — `{ name, openrouter_api_key?, allowed_emails? }`, and a key that OpenRouter rejects is a 400 that creates nothing. `GET` lists only what the caller may open |
| `GET\|PATCH\|DELETE /api/agents/:agentId` | Read / rename / delete an agent and everything it owns. `PATCH` takes `{ name?, allowed_emails? }` |
| `GET\|PATCH /api/agents/:agentId/config` | That agent's settings, capabilities and their metadata |
| `GET\|POST /api/agents/:agentId/mcp` | That agent's MCP servers |
| `GET\|POST /api/agents/:agentId/sessions` | List / create that agent's sessions. GET takes `?limit` (default 30, max 200) and `?cursor`, and answers `{ sessions, has_more, cursor }` |
| `PATCH\|DELETE /api/sessions/:sessionId` | Rename / delete a session |
| `POST /telegram/webhook/:agentId` | One route per agent, because one bot per agent |

## Agents

An agent is a bot, its settings, its tools and its conversations. Agents share nothing:
each has its own OpenRouter key, its own Telegram bot, its own MCP servers, its own
memories and its own sessions. Traffic to one never queues behind another.

That falls out of the object layout. Durable Object namespaces cannot be enumerated —
you can address an instance by name but not ask which instances exist — so there are
three layers of index:

- **`AgentDirectory`**, one well-known object, holding the list of agents. Names only.
- **`SessionRegistry`**, one per agent, holding everything that agent *is*: settings,
  credentials, MCP servers, memories, and the index of its sessions.
- **`SessionAgent`**, one per conversation, holding a transcript and its files.

`SessionAgent` is a single namespace for the whole Worker, so a session id carries the
agent that owns it: `<agentId>~<local>`. Two agents in the same Telegram chat would
otherwise both want `tg-123` and land on the same object. The prefix is also how a
session finds its agent — a Durable Object knows nothing about itself but its own name.

Every `/agents/session-agent/:sessionId/...` route therefore takes that whole prefixed
id, and needs no agent of its own in the path.

## Who can open an agent

Each agent carries a list of email addresses in `AgentDirectory`. Everyone on it gets
the whole agent — its chats, its settings and its keys — so it is a list of owners, not
of guests. The creator is always on it, and an edit that would remove the editor or
empty the list is refused: an agent nobody is on is one nobody can get back into.

Two headers carry the caller's authority, and the frontend adds both to every call it
forwards:

- `x-api-secret` — must equal the Worker's `API_SECRET`. It is what says the call came
  from the app at all; the Worker is on the public internet, so without it anyone could
  read an agent's settings, keys included, straight out of the API.
- `x-user-email` — the signed-in address, taken from Clerk on the server. The Worker
  trusts it *because* the secret vouched for the caller.

Set `API_SECRET` (`wrangler secret put API_SECRET`) and everything under `/api` and
`/agents` needs the pair; an address not on an agent's list is told the agent does not
exist rather than that it may not have it. Session routes are covered by the same list —
a session id names its agent. Leave `API_SECRET` unset and the Worker is open, which is
what local development wants and is wrong anywhere else.

Two routes are deliberately outside all of this:

- `POST /telegram/webhook/:agentId` — Telegram proves itself with the per-bot secret
  token it echoes back, and per-chat access is the bot's own whitelists.
- `GET /api/mcp/oauth/callback` — arrives from the provider's browser, carrying a state
  token instead of a header.

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
| Audio input | input | an OpenRouter model that accepts audio | — |
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
