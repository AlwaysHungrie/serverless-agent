# Architecture

How this project is put together, for someone who has just cloned it and has never
deployed anything to Cloudflare. It starts with the platform, because every structural
decision here is downstream of what Cloudflare's primitives can and cannot do, and ends
with the one object in the design that cannot be scaled horizontally — what it still
carries, and what was moved off it.

---

## Two deployables

There are exactly two things that get deployed, and they do not share a process, a
runtime or a repository directory.

**`frontend/`** is a Next.js app, managed with pnpm. It renders every page the user sees
and holds the Clerk session. It never talks to the agent from the browser.

**`agent/`** is a Cloudflare Worker, deployed with `wrangler`. It is the whole backend:
the HTTP API, the storage, the model calls, the Telegram bot, the MCP clients. It has no
UI at all — hitting `/` on it returns a JSON list of its own routes.

The split is not layered in the usual sense. The frontend's `/api/*` route handlers are
thin proxies and nothing more: [proxy.ts](../frontend/src/lib/proxy.ts) forwards the path
to `AGENT_URL`, hands the Worker's response body back with the status unchanged, and
turns a connection failure into a readable JSON 502 instead of an empty error body. There
is no business logic on the Next side. `frontend/src/app/api/agents/route.ts` is six lines.

The proxy layer exists for one reason: **it is where a signed-in user becomes authority.**
[upstream.ts](../frontend/src/lib/upstream.ts) reads the Clerk session on the server —
`currentUser()`, not a value from the request body, and the module is marked
`server-only` so a client component cannot import it — and attaches two headers to every
forwarded call:

| Header | What it means |
| --- | --- |
| `x-api-secret` | This call came from the app. It must equal the Worker's `API_SECRET`. |
| `x-user-email` | The signed-in address the call is being made on behalf of. |

The Worker trusts the second header *because* the first one vouched for it. That is the
entire trust model, and it only works because the browser never holds the secret and
never reaches the Worker directly — which is also why there is no CORS problem to solve
and no key to leak.

A Worker deployed without `API_SECRET` set is completely open. That is deliberate:
`trustedCaller()` in [server.ts](../agent/src/server.ts) returns `true` when the variable
is unset, so `wrangler dev` and `next dev` work with no setup. It is also wrong anywhere
that is not a laptop.

On the frontend side, Clerk is enforced in [proxy.ts](../frontend/src/proxy.ts) — Next 16's
name for what used to be `middleware.ts` — which protects everything except `/`, the auth
screens and the SSO callback. So a signed-out visitor never reaches a route handler that
would have called the Worker anyway.

Two Worker routes sit outside all of this on purpose. `POST /telegram/webhook/:agentId`
authenticates with a per-bot secret token that Telegram echoes back, derived by SHA-256
from the bot token itself so there is nothing extra to store. `GET /api/mcp/oauth/callback`
arrives from a provider's browser redirect and carries a state token instead of a header;
it is matched before the secret gate for exactly that reason.

---

## The Cloudflare primitives, in plain terms

Three products carry this whole system. If you already know them, skip to the next
section.

**A Worker** is a function that runs on Cloudflare's edge in response to an HTTP request.
It is stateless and short-lived: it starts, handles one request, and goes away. Many
copies run at once, in whichever datacenter is closest to the caller, and no two of them
can see each other. It cannot hold anything between requests — no in-memory cache you can
rely on, no local disk. Here, the Worker is [server.ts](../agent/src/server.ts): it routes,
it checks the two headers, and it forwards the work to something that *can* hold state.

**A Durable Object (DO)** is the thing that can. A DO class is instantiated by *name*, and
Cloudflare guarantees that for a given name there is exactly one live instance in the
world at a time, in one datacenter, running one JavaScript thread. Ask for the object
named `root` from ten Workers in ten countries and all ten calls land on the same object.
Each instance gets its own private SQLite database, which is a real embedded database with
tables and indexes and transactions, not a key-value bag. Because there is only ever one
instance, you get serialization for free: two concurrent writers cannot race, and you
never need a lock.

The word *durable* means the object and its storage survive being evicted from memory. An
idle object is hibernated; the next request wakes it and its SQLite is still there. That
also means a DO namespace can be **addressed but not enumerated** — you can ask for the
object named `alice`, but you cannot ask "which objects exist?". That single limitation is
the reason two of the three DO classes below exist at all.

DOs are *not* strictly serial. They are ordinary JavaScript, so `await` yields and a
second request can interleave while the first is waiting on the network; Cloudflare's
input and output gating is what keeps storage consistent across those interleavings. One
thread, not one request at a time.

**R2** is object storage — a bucket you put blobs in and get blobs out of, addressed by
key, priced for bulk, with no query language. It is where bytes go when they are too big
to want in a SQLite row. Here that is `serverless-agent-files`, bound as `FILES` in
[wrangler.jsonc](../agent/wrangler.jsonc).

The bindings in [wrangler.jsonc](../agent/wrangler.jsonc) are how the Worker reaches any of
this: three DO namespaces (`SessionAgent`, `SessionRegistry`, `AgentDirectory`), one R2
bucket, and plain `vars` for the default `MODEL` and the `MODELS` catalogue the settings
page offers. The `migrations` array there is Cloudflare's own class-registration mechanism
— `new_sqlite_classes` tells the platform a class exists and is SQLite-backed. It has
nothing to do with table schemas; those are handled separately, and the difference matters
later.

---

## The three Durable Object classes

Each class answers a question the layer below it cannot.

### AgentDirectory — one object, named `root`

There is exactly one instance of this class in the entire deployment:
`env.AgentDirectory.get(env.AgentDirectory.idFromName("root"))`. It holds the index of
which agents exist, and who may open each one.

It exists *only* because a DO namespace cannot be enumerated. "List the agents" is not a
question the platform can answer, so the answer has to be written down somewhere, and
somewhere has to be one agreed place. It is deliberately thin: an agent's id, name,
timestamps, its access list and its admin. Everything an agent actually *is* lives one
layer down.

Its copy of the access list is a **derived index**, not the authority. It exists so the
home page can answer "which agents may this address open" in one query, and it decides
nothing — see [Two copies, one authority](#two-copies-one-authority).

### SessionRegistry — one per agent

Named by the agent id. This is the agent: its settings and secrets (`config`), the meta
document that decides what its own pages may change (`meta`), its long-lived `memories`,
its `mcp_servers` with their OAuth tokens, the index of its `sessions` — which exists for
the same reason the directory does, one level down — and its `access` table, which is the
authority on who may open the agent at all.

Because it is one object per agent, two agents share nothing. One agent's OpenRouter key
and bot token are unreachable from the other's object, and a burst of traffic to one
queues on its own thread rather than on anybody else's.

### SessionAgent — one per chat session

This is the one that actually runs turns. It extends `Think` from `@cloudflare/think`,
which owns the agentic loop, the transcript, tool execution, streaming and recovery — see
[think-migration.md](think-migration.md) for what that change moved. This class keeps the
four side tables Think has no opinion about (`attachments`, `message_files`,
`message_text`, `usage`) plus `file_cache`, and a workspace — a virtual filesystem the
model reads with its own tools — whose large files spill into R2 under the session's own
key prefix.

`SessionAgent` is a single namespace for the whole Worker, so a session id has to carry
the agent that owns it: **`<agentId>~<local>`**. Without the prefix, two agents in the same
Telegram chat would both want the session named `tg-123` and would land on the same
object. The prefix is also how a session finds its own agent, since a DO knows nothing
about itself except its own name — `agentIdOf()` splits on the `~` and that is the whole
lookup. It is why every `/agents/session-agent/:sessionId/...` route needs no agent id of
its own in the path.

---

## Where every kind of data lives

| Data | Lives in | Notes |
| --- | --- | --- |
| Which agents exist, names, timestamps | `AgentDirectory` (`agents`) | One object, named `root`. |
| **Who may use an agent — the decision** | `SessionRegistry` (`access.allowed_emails`) | **Authoritative.** Every access check reads this. |
| **Who administers an agent — the decision** | `SessionRegistry` (`access.admin_email`) | **Authoritative.** Written once at creation, never again. |
| Who may use / administer an agent — the index | `AgentDirectory` (`agent_members`, `agents.allowed_emails`, `agents.admin_email`) | Derived. Used only by `list()`, never to decide a request. |
| Agent settings, model, prompt, capability flags | `SessionRegistry` (`config`) | One row, `id = 1`. |
| OpenRouter key, Brave key, Telegram bot token | `SessionRegistry` (`config`) | Plain text. See [Rough edges](#known-rough-edges). |
| The meta document and its locks | `SessionRegistry` (`meta`) | JSON in one row. |
| Memories | `SessionRegistry` (`memories`) | Per agent, not per session — a fact worth keeping is worth keeping next session. |
| MCP servers and their OAuth tokens | `SessionRegistry` (`mcp_servers`) | |
| The session index for one agent | `SessionRegistry` (`sessions`) | Paged by cursor. |
| Transcript, messages, tool calls | `SessionAgent`, owned by Think | Tree-structured session storage. |
| What the user actually typed | `SessionAgent` (`message_text`) | The stored message also names the files the turn carried; that annotation is for the model. |
| Attachment metadata and message→file links | `SessionAgent` (`attachments`, `message_files`) | |
| Per-message tokens, cost, duration | `SessionAgent` (`usage`) | |
| Attachment bytes, model-written files, PDF page renders | The session workspace, spilling to R2 under `<session-id>/` | |
| **User identity, passwords, profiles, sessions** | **Clerk. Not here.** | The only thing this system stores about a person is their email address, as a string, in `allowed_emails` / `agent_members` / `admin_email`. |

That last row is worth dwelling on. There is no users table anywhere in this codebase.
An identity is an email string that Clerk vouched for and the frontend forwarded. Nothing
is keyed on a user; everything is keyed on an agent or a session.

---

## The request lifecycle of a chat message

The path a single message takes, end to end. The chat route is the one frontend route
that does not use `proxy()` — it needs to translate the Worker's SSE frames into the AI
SDK's UI message protocol, so it calls `fetch` itself and adds the same headers by hand.

```
  browser
    │  useChat POST /api/sessions/<agentId>~<local>/chat   { messages, trigger }
    ▼
  Next route handler — frontend/src/app/api/sessions/[id]/chat/route.ts
    │  pulls the last user message's text out of the UI messages
    │  retry? trigger === "regenerate-message"
    │  agentHeaders() → reads Clerk server-side → x-api-secret + x-user-email
    ▼
  POST {AGENT_URL}/agents/session-agent/<id>/stream   { message, retry }
    │
    ▼
  Worker fetch() — agent/src/server.ts
    │  1. trustedCaller()  — x-api-secret must equal API_SECRET
    │  2. session-route gate: agentIdOf(id) → mayUseAgent()
    │        └── agentAccess() → SessionRegistry(agentId).access()
    │              the AGENT'S OWN object answers. The directory is not read.
    │              (unseeded agent only: one directory read, then seedAccess())
    │            → emailAllowed(access.allowed_emails, email)
    │            not allowed → 404, never 403
    │  3. ctx.waitUntil(SessionRegistry(agentId).touch(sessionId)   ← exact, sidebar order
    │                   → AgentDirectory.touch(agentId))           ← skipped unless the
    │                       agent's date is already 5+ minutes stale; off the response
    │                       path either way
    │  4. routeAgentRequest(request, env) → the SessionAgent DO named <id>
    ▼
  SessionAgent.onRequest() — agent/src/agent.ts
    │  ensureSchema(); loadConfig()  ← reads its SessionRegistry, per turn, so a
    │                                  settings change takes effect on the next message
    │  streamChat(message, retry)
    │    beforeTurn(): model, system prompt, temperature, reply cap, reasoning
    │                  effort, context window, memories, capability + MCP tools
    │    runTurn({ mode: "stream" }) → Think → OpenRouter
    │      the turn runs against the OBJECT, not against this request; every
    │      event is banked, so a reloading browser can reattach via /live
    │    onEvent → SSE frames: delta / tool / tool_done / usage / done / error
    │    onChatResponse → one `usage` row against the assistant message
    ▼
  SSE back up through the Worker (CORS headers added), streamed, not buffered
    ▼
  bridge() in the Next chat route
    │  delta      → text-delta   (one text part per tool round, in order)
    │  tool/_done → data-tool
    │  usage      → data-usage   (tokens, cost, latency)
    ▼
  useChat renders it
```

The Durable Object stays resident — and billable — for the whole stream, which is why
model latency shows up in the Cloudflare bill as well as the OpenRouter one; see
[cloudflare-durable-object-costs.md](cloudflare-durable-object-costs.md). Pressing stop
cancels the browser's stream, but the turn itself finishes inside Think and the partial
reply is persisted along with the tokens OpenRouter already charged for.

---

## The access model: admin is not membership

This was recently split in two, and the two halves do not overlap.

**`admin_email`** is the address that created the agent. It is written exactly once, at
creation, and there is no route anywhere that changes it — an agent whose administrator
can be handed over is an agent that can be taken. On an unguarded deployment, where there
is no signed-in caller to name, it falls back to the first address on the access list.

**`allowed_emails`** is who may *use* the agent. Everyone on it gets the
whole agent — its chats, its settings, its keys — so it is a list of owners, not of guests.
At creation the list is exactly what was asked for and the creator is **not** silently
appended to it; the create dialog pre-fills the box with their address, so leaving it out
is a deliberate act. Editing the list later is different: the editor is always kept on it,
because removing yourself would hand the agent to the remaining addresses and lock you out
of the only page that could undo that. Either way the list may not end up empty.

The consequence worth internalising: **an admin who is not on the access list is refused
the agent's pages exactly like a stranger.** `mayUseAgent()` checks `allowed_emails` and
nothing else — it never looks at `admin_email` — so every session route, every stream,
every file operation is closed to an admin who did not put themselves on the list. This is
tested behaviour, not intent: against a running Worker, a member gets 200 on `/config`
where an admin who is not a member gets 404, and the admin gets 200 on `/meta` where the
member gets 404. A stranger gets 404 everywhere.

`handleAgents()` in [server.ts](../agent/src/server.ts) computes both flags once and then
gates section by section:

| Route | Who |
| --- | --- |
| `GET /api/agents/:agentId` | Either. The row is what the admin dialog's header shows, and says nothing an admin does not already know. |
| `PATCH /api/agents/:agentId` (rename, edit access list) | User only. These are settings-page edits. |
| `DELETE /api/agents/:agentId` | **Admin only.** Someone given access to use an agent should not be able to take it from everyone else who was. |
| `/config` | User only. |
| `/meta` | **Admin only.** It decides the defaults and the locks, so a user who could edit it could unlock everything locked away from them. |
| `/mcp` | User only — except `?meta=1`, which is the server list inside the admin dialog. |
| `/sessions` | User only. |
| `/telegram/status` | User only. |
| `/agents/session-agent/:sessionId/*`, `/api/sessions/:sessionId/*` | User only, gated in `fetch()` before routing, via the agent id embedded in the session name. |

The catch-all is one line after the per-section checks:
`if (!isUser && section !== "meta" && section !== "mcp") return notFound();`

Refusals are **404, not 403**, everywhere. An agent you were not given is an agent that
does not exist; a 403 would confirm the id is real.

An unguarded deployment (`API_SECRET` unset) sets both `isUser` and `isAdmin` true, since
there is no identity to check against and pretending otherwise would lock local
development out of its own agents.

### Two copies, one authority

Access data exists in two Durable Objects, and which one is in charge is the single most
important invariant in this system.

**`SessionRegistry.access` is the authority.** One row, `id = 1`, holding
`allowed_emails`, `admin_email` and `seeded`. Every access decision — `mayUseAgent()` for
session routes, `isUser` and `isAdmin` for every section of `handleAgents()` — is taken
from here, through `agentAccess()` in [server.ts](../agent/src/server.ts).

**`AgentDirectory`'s `agents` / `agent_members` is a derived index.** It is read by
`list()` to build the home page, and by `handleAgents()` to fill in the name and
timestamps of a response body. **It never decides whether a request is allowed.**

The reason for the split is the next section's whole subject: the registry is one object
per agent and scales horizontally, the directory is one object for the deployment and does
not. Putting the check in the registry takes the singleton off the per-message path.

Access lives in its **own table and not in `config`**, and that is deliberate to the point
of being the most important implementation detail here. The `config` row is walked by
`redact()` and `validateConfig()` in the Worker, returned whole by `GET /config`, and
patched by `PATCH /config`. An access column living there would therefore be shipped to
the browser *and* editable by anyone the access list already admits — the gate would be
reachable from the thing it guards, and any member could quietly add themselves as admin
or remove everyone else. A separate table is what makes that structurally impossible
rather than merely unlikely.

`admin_email` immutability is enforced *inside* `setAccess()` rather than trusted to call
sites: a write carrying an admin for an agent that already has one keeps the one it has.
There is no route that moves it in any case, but the rule now lives with the data.

### Write order, and which way a failure falls

**No transaction spans two Durable Objects.** Two writes, two round trips, and either can
land without the other. So the order is not a style choice — it decides which way a
partial failure falls.

**Registry first, directory second**, on agent creation and on `PATCH allowed_emails`
(which is a normal, frequent operation: any member may edit the list at any time).

| | Registry first (implemented) | Directory first (rejected) |
| --- | --- | --- |
| Second write fails | Gate is already correct. The removed address is denied immediately, but still sees the agent on their home page until the list is saved again — an entry that 404s when opened. | Struck off the index but **still admitted by the gate**. Somebody keeps access they were meant to lose. |
| Verdict | Cosmetic | A security hole |

On creation, a failure between the two leaves an agent nobody can see and nobody can open:
an orphan object, not a leak.

**`deleteAgent()` is the deliberate exception — the directory row is removed *first*.** The
reason is the lazy seed below: `wipe()` leaves the registry unseeded, and an unseeded
registry asks the directory. Wiping first would let a request arriving mid-teardown read
the directory row that is still there and seed the access list straight back into the
object being destroyed. Removing the name first closes both doors at once — the gate finds
no agent to seed from, and every control-plane route 404s from that moment on.

### The lazy seed, and why it cannot lock anyone out

Agents created before access moved into the registry have their list only in the
directory. The `seeded` flag is what keeps that from being a catastrophe on deploy.

**Unseeded is not "nobody is allowed". It is "nobody has asked yet".** Reading a missing
row as an empty list would have refused every existing user of every existing agent the
moment this shipped. So the two states are different values: an agent with a genuinely
empty list is `seeded = 1` with `allowed_emails = ''`, and it does deny.

The first access check on an unseeded agent reads the directory once, calls `seedAccess()`
to adopt that list, and serves from the registry forever after. One directory read per
agent for the life of the deployment — not one per message. There is no loop over all
agents anywhere; migration is entirely lazy and incremental, in the same spirit as
`ensureSchema()`.

`seedAccess()` only ever fills in an agent nobody has written access for; it returns early
on an already-seeded row and never overwrites a decision. It also contains no `await`, so
a Durable Object runs it to completion before a second caller starts — and two concurrent
seeders would be writing byte-identical rows anyway, both having read the same directory
row. The race is benign even where it is visible.

This path is tested: with the `access` table wiped to simulate a pre-migration agent, the
member still got 200, the admin kept `/meta`, and a stranger still got 404.

---

## The directory's membership index

Everything in this section is about the **index**, not the gate. Nothing here decides a
request; it exists so that one query can answer "which agents may this address open" for
the home page.

Inside the directory, membership is itself stored twice, and those two *are* written in
one transaction — they are in the same object, so they can be. `agent_members` is one row
per `(agent_id, email)`, with an index on `email`: it is what makes the listing an index
lookup instead of a walk over every agent in the deployment. `agents.allowed_emails` is
the same list as newline-separated text on the agent row — a denormalized projection, not
a second opinion. `writeMembers()` is the only method that writes either of them and it
writes both inside one `transactionSync`.

Keeping the column means `get()` stays a single-row read with no join. That no longer
matters for throughput the way it once did — `get()` came off the per-message path when
the access decision moved to the registry — but it keeps the control-plane read cheap and
it is why the shape the Worker and browser see never changed when the table was added.

### Why `list()` uses UNION

There are two ways onto an agent's list — you administer it, or you are a member — and the
obvious query is `WHERE admin_email = ? OR EXISTS (SELECT 1 FROM agent_members …)`. That
returns the right rows and is the wrong query: **SQLite cannot use an index for an `OR`
spanning two tables.** It falls back to scanning every agent and running the subquery per
row, which is precisely the walk `agent_members` was added to remove.

Split into a `UNION` of two selects, each half is an index lookup — `idx_agents_admin_email`
for the left, `idx_agent_members_email` for the right. `UNION` rather than `UNION ALL`
because it deduplicates, which is what keeps an admin who is also on the access list from
appearing twice in the list of agents.

### Why migrations run on first touch

Cloudflare's `migrations` in `wrangler.jsonc` register DO *classes*; they say nothing about
tables. There is no deploy-time hook that could run SQL against every Durable Object,
because a DO's storage only exists where the object does, and an object that has never
been woken has nowhere for a migration to run. So schema work happens in `ensureSchema()`,
called at the top of every public method, guarded by an in-memory `ready` flag so it costs
one branch after the first call in an instance's life.

Additive changes are idempotent and need no bookkeeping: `CREATE TABLE IF NOT EXISTS`,
and `ALTER TABLE … ADD COLUMN` wrapped in a `try` that swallows "column already present".
The `admin_email` backfill is in the same category, because "no admin" is a state the data
can express, so re-running it is harmless.

Membership is not in that category, and that is what `schema_version` is for. An agent with
no rows in `agent_members` is indistinguishable from one that has not been migrated yet,
and guessing wrong would silently re-add addresses somebody deliberately removed. So the
version number is written down, in its own table, inside the same transaction as the
backfill it guards. The v1 migration reads `allowed_emails` and populates `agent_members`
from it; it drops nothing.

The registry's `seeded` flag is the same pattern one object down, for the same reason: a
state the data cannot otherwise express has to be recorded rather than inferred. The
difference is that `schema_version` guards a migration that runs once inside one object,
while `seeded` guards one that pulls from a *different* object — so it is driven by the
first request that needs the answer rather than by a version bump.

---

## The single-DO bottleneck

This is the known structural limit of the design. It used to sit on the path of every
message; it no longer does, and this section says both what changed and what is still
true. The limit has not gone away — it has become much narrower.

### The shape of the problem

`AgentDirectory` is **one object**. Not one per tenant, not one per region — one, named
`root`, for the entire deployment. It is single-threaded and it lives in exactly one
datacenter.

### Why Cloudflare cannot scale this away

This is not a configuration problem and there is no flag to set. A Durable Object is
single *by definition* — the singleness **is** the consistency guarantee. The reason you
never need a lock when writing to `agent_members` is the same reason you cannot add a
second copy of the directory: if there were two, they would not be a Durable Object any
more.

Cloudflare scales the *number* of Durable Objects, essentially without limit. It never
scales one. The platform's answer to "this object is too busy" is always "use more
objects", which works beautifully for `SessionRegistry` and `SessionAgent` and not at all
for a singleton index.

DOs do handle requests concurrently — it is JavaScript, so an `await` on a subrequest
yields, and input/output gating is what keeps storage consistent across the interleaving.
So this is not strictly serial and a slow call does not stall everything behind it. But it
is still one thread, one core's share of one machine, in one place.

### What still reaches it

The access check used to. It does not any more: `mayUseAgent()` resolves through
`agentAccess()` to the agent's own `SessionRegistry`, and **for a seeded agent the session
path does not read the directory at all.** What is left:

| Reaches the directory | How often |
| --- | --- |
| `GET /api/agents` — the home page listing | Once per home page load. One indexed `UNION`. |
| `POST /api/agents` — create | Once per agent ever. |
| `DELETE /api/agents/:id` — delete | Once per agent ever. |
| `dir.get()` in `handleAgents()`, to build a response body | Once per `/api/agents/:agentId/*` request — settings pages, not messages. |
| `touch()` | At most once per agent per 5 minutes. |
| Seeding an agent that predates the `access` table | **Once per agent, ever.** |

**A chat message now costs the directory nothing** on a seeded agent — no read for the
gate, and a `touch()` that is a row read which returns early on all but the first message
in any five-minute window. Session creation still awaits one `dir.touch()`, which is rare
enough not to matter.

So the remaining exposure is **control-plane and listing traffic, not message traffic**.
That is a far higher ceiling: a user loads the home page occasionally and opens a settings
page rarely, where they send messages continuously.

### What is still true

**The ceiling still exists.** It is just much further away. Home-page listings and
control-plane reads still all land on one thread in one datacenter, and there is still no
sharding escape hatch — the only structural remedy left is (d) below.

**The latency floor still applies to those operations.** The object is placed near
whoever first created it and stays there, so a user in Sydney whose directory object lives
in Frankfurt pays that round trip when they load the home page or open a settings page.
They no longer pay it on every message, which was the part that mattered.

### When it bites, and what to measure

Do not plan against a number from this document. Measure:

1. **Requests per second reaching the directory object**, which Cloudflare's per-object
   analytics will tell you (the DO id is recorded on session rows as `object_id` for
   exactly this kind of attribution — see
   [cloudflare-durable-object-costs.md](cloudflare-durable-object-costs.md)).
2. **The ratio of directory hits per user action**, which is the number to watch for
   regressions. It is currently zero per message and roughly one per page load. Any change
   that puts a `directory(env)` call back on a session route undoes this section; that is
   the thing to catch in review.

Writes are still the expensive half — row writes cost about a thousand times row reads in
Cloudflare's own pricing, a fair proxy for how much more work they are, and a write must
be durably committed where a read can often be served from memory. But the directory's
per-message write is gone, so what remains is creates, deletes, membership edits and a
heavily throttled `touch()`.

Any specific requests-per-second figure you find — including any you might be tempted to
add to this document later — should be checked against current Cloudflare documentation
rather than trusted from a doc. The numbers move.

### The one remaining structural mitigation

The cheap fixes are spent: `touch()` is already coarsened, and the access check has
already moved to the per-agent object, which is what took the singleton off the hot path.
Caching `directory.get()` in the Worker, which an earlier draft of this document proposed,
is now largely moot — the reads it would have cached are the ones that no longer happen,
and the ones that remain are already rare.

What is left, if listing and control-plane traffic ever saturates one object:

**Move `AgentDirectory` to Postgres, reached via Hyperdrive.** A real database can be read
from everywhere at once and indexed however you like. The tradeoffs are real and should not
be glossed: connection pooling becomes your problem (Hyperdrive helps, it does not
eliminate it); there is added latency on calls that are currently an in-process SQLite
read; you lose free serialization and inherit transactions and isolation levels as things
you have to think about; and the blast radius changes completely — per-agent secrets that
currently sit in isolated objects, unreachable from one another, would sit in one database
that one credential opens.

That last point is now a weaker objection than it was, because the directory no longer
holds anything that decides access — moving it would move an index, while the authority
stayed distributed across the per-agent objects. Still the largest change here, and the one
to justify most carefully.

### What is *not* affected

`SessionRegistry` and `SessionAgent` do not have this problem and will not develop it.
They are per-entity: one object per agent, one per session. Ten thousand agents are ten
thousand independent objects on ten thousand independent threads, placed near whoever
uses them, sharing nothing. `SessionAgent` never reads the directory at all — it finds its
own agent by splitting its own name and talks only to that agent's registry. The access
check now rides the same per-agent object, which is why it scales the same way.

**Only the singleton has this problem.** Everything else already scales the way the
platform intends.

---

## Known rough edges

**API keys are stored in plain text.** The OpenRouter key, the Brave key, the Telegram bot
token and MCP OAuth tokens all sit as ordinary text columns in `SessionRegistry`'s SQLite.
They are redacted on the way out — a saved key reads back as a mask, and sending the mask
back means "leave it alone" — so they do not reach the browser, but anyone with access to
the Durable Object can read them. [agent/README.md](../agent/README.md) flags this
explicitly as deliberate for now, with the note that they should move to Worker secrets or
an encrypted store before this handles anyone else's keys.

**The dual-write window is real and unreconciled.** A membership change writes the
registry, then the directory, and nothing spans both. If the second write fails, the two
disagree until someone saves the list again: the gate is correct and the home page is
stale. It is bounded to a single RPC, it always falls in the safe direction (see [Write
order](#write-order-and-which-way-a-failure-falls)), and there is no background reconciler
or repair pass. Adding one is the obvious next step if the window ever proves to matter.

**Concurrent access-list edits are last-write-wins.** `setAccess()` replaces the whole
list and there is no compare-and-set, so two members saving the page at the same time can
have one edit silently lost — the second save is built on a list read before the first one
landed. This predates the split and was not changed by it, but it is worth knowing given
that any member may edit the list at any time.

**`deleteAgent()` is not atomic.** It is a multi-step teardown: unhook the Telegram
webhook, remove the row from the directory, walk every page of the session index
destroying each session object, then wipe the registry. A crash partway through the walk
leaves orphaned `SessionAgent` objects that nothing points at any more — invisible,
unreachable, and still billed for the bytes they store, along with the registry that would
have been wiped last. Nothing retries or sweeps them. The ordering is at least chosen
deliberately at both ends — the bot is unhooked first, so Telegram is not retrying against
a 404 that costs requests, and the name goes before the storage so nothing can be admitted
to an agent that is halfway gone — but there is no compensating transaction.

**No cross-agent queries are possible.** By construction. Each agent's data lives in its
own Durable Object with its own database, and there is no join across objects. "How many
messages did every agent send this week" cannot be answered without fanning out to every
registry one at a time. The directory holds names and access lists and nothing else, so it
cannot answer it either. This is the price of the isolation that makes agents share
nothing, and it is not a bug — but it does mean analytics across agents needs a different
store, not a cleverer query.
