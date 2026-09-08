# The session agent on Think

`SessionAgent` extends [`Think`](https://www.npmjs.com/package/@cloudflare/think)
rather than driving OpenRouter itself. Think owns the agentic loop, the transcript,
tool execution, streaming and durable recovery; this file records what changed around
it, because the REST surface and the frontend are unchanged.

## What Think now owns

- **The loop.** `maxSteps = 6`, the same ceiling the hand-written loop had. Tool calls,
  retries, and the model call are the framework's.
- **The transcript.** A tree-structured Session in Durable Object SQLite, with
  branching, compaction and full-text search available. `getMessages()` reads it.
- **Streaming and recovery.** A turn interrupted by eviction resumes; a partial reply
  is persisted rather than lost.
- **Workspace tools.** `read`, `write`, `edit`, `list`, `find`, `grep`, `delete` and a
  sandboxed `bash`, on every turn, over the session's own filesystem.

## What this agent still owns

Three side tables, because Think has no opinion about any of it:

| Table           | Holds                                                          |
| --------------- | -------------------------------------------------------------- |
| `attachments`   | What a file is: kind, name, mime, workspace path, thumbnail    |
| `message_files` | Which message carried which file                               |
| `message_text`  | What the user actually typed, before file notes were appended  |
| `usage`         | Per-message tokens, cost and duration, plus the timestamp      |

Everything the settings and capabilities pages control is applied per turn in
`beforeTurn()`: model, system prompt, temperature, reply cap, reasoning effort,
context window, and the capability tools that are ready to run. The registry object
stays the single source of truth, so a toggle takes effect on the next message.

## Attachments

Bytes live in the Think workspace, which spills past ~1.5MB into R2 under the
session's own prefix. An upload writes to `uploads/<id>/<name>`; a PDF's first-page
render sits beside it at `uploads/<id>/thumb.png`.

The turn does **not** inline the bytes. The user's message names each file and its
workspace path, and the model opens what it needs with the `read` tool — which passes
images and PDFs to a multimodal model itself. Two consequences worth knowing:

- A PDF is no longer base64'd into every later prompt in the conversation, so a long
  session with a big attachment costs far less than it used to.
- Reading a file costs one tool round. The model sees the file only if it asks.

Audio is unchanged: the clip is stored untranscribed and the model calls
`transcribe_audio` with the attachment id when the words matter.

## Cost accounting

`onStepFinish` accumulates per-step usage; OpenRouter's exact dollar figure arrives on
`step.usage.raw.cost` and is preferred over the local price table. `onChatResponse`
writes one `usage` row against the assistant message Think just persisted.

## Retry and fork

- **Retry** deletes the trailing assistant messages and the question behind them with
  `session.deleteMessages()`, hands that question's files back as pending, and runs the
  turn again.
- **Fork** exports the first N messages, their files as base64, and the
  `message_files` / `message_text` rows, then replays them into a new session with
  `addMessages()`. Message ids are preserved, so the links land on the right rows.

## Known trade-offs

- The system prompt is larger: Think's workspace tool definitions ride on every turn.
  Set `workspaceBash = false` on the class for a smaller surface if the model never
  needs shell-shaped file work.
- Stopping a stream closes the SSE response, but the turn keeps running to completion
  inside Think and is persisted. The old loop aborted the upstream call.
- Message ids are UUIDs from the session tree, not the row numbers the old `messages`
  table handed out.
