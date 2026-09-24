# WhatsApp channel — build handover

Goal: the same agent that answers on Telegram answers on WhatsApp, over Meta's
official Cloud API. First prove a round trip on Meta's **free test number**, then
productionise. No UI, no config storage, no multi-tenant work until the spike is green.

Owner-decided scope for this pass: **one private assistant, answering one person**
(the project owner's own WhatsApp number). Not a customer-facing feature yet.

---

## Phase map

| Phase | What | Exit criteria |
|---|---|---|
| 0 | Meta-side setup, by hand in the dashboard | Four credentials in hand, `hello_world` template delivered to the owner's phone |
| 1 | Spike: webhook + send, creds from env vars, staging only | Owner messages the test number, agent replies with a real model answer, retries don't double-reply |
| 2 | Productionise: capability + config columns + per-agent route + tests | `npm test` green, `npm run deploy` passes its own gate |
| 3 | UI, whitelist editing, media, templates | Deferred. Do not start before 2 is merged |

---

## Why the test number

No new SIM, no KYC, no paperwork, free. Every WhatsApp app in the Meta dev dashboard
gets one. It messages up to **5 verified recipient numbers**, bidirectionally,
unlimited and unbilled. It is a development resource — Meta can rotate or reclaim it,
and it cannot use custom templates — so treat it as free and revocable. Moving to a
paid number later (a Twilio-purchased number is the cheapest path) changes only the
`phone_number_id` and the token; no code changes.

## Policy constraints this design must keep (decided, do not relitigate)

Meta's terms prohibit "AI Providers" from using the WhatsApp Business Platform to make
AI available where AI is the *primary* functionality. A private single-user assistant
is not making anything available to anyone, and the terms explicitly contemplate a
business retaining an AI provider as a service provider. What keeps that true:

- **Whitelist of one.** Exactly one `wa_id` may be answered. Never `*`, never a second
  person, deny-by-default when the list is empty (opposite of the Telegram default,
  where an empty list allows everyone — see `allowedBy` in `agent/src/telegram.ts`).
- **No unsolicited outbound** to anyone, ever. No bulk, no broadcast.
- **No-train model routing** for WhatsApp-sourced turns: the terms forbid letting
  platform data train third-party models. Pin OpenRouter to zero-retention/no-train
  providers for these turns, or note it as a known gap in the PR.
- The capability stays unadvertised in marketing while it is a private setup.

## What already exists to mirror

| Concern | Telegram implementation |
|---|---|
| Transport client | `agent/src/telegram.ts` — `class Telegram`, plus pure helpers (`split`, `messageText`, `allowedBy`, `chatTitle`) |
| Webhook handler | `handleWebhook` in `agent/src/server.ts:2283` — verifies secret, resolves session, `ctx.waitUntil(turn)`, returns 200 fast |
| Route dispatch | `agent/src/server.ts:2571` — `POST /telegram/webhook/:agentId` |
| Turn | `telegramTurn` in `agent/src/agent.ts:1825` — commands, spend guard, file ingest, reply, drawn images |
| Proactive delivery | `deliverToChat` in `agent/src/agent.ts:1089` — used by scheduled tasks |
| Session keying | `sessionIdForChat` in `agent/src/registry.ts:426` (`tg-<chatId>`), `forChat`, `freeChatSessionId` |
| Capability descriptor | `agent/src/capabilities.ts:212` — fields render generically in the frontend, so no UI code is needed for config |
| Config columns | `CONFIG_MIGRATIONS` in `agent/src/registry.ts:276` — **append-only**, order matters |

`impact` was run on the symbols this work touches: `telegramTurn` (1 caller,
`onRequest`) and `sessionIdForChat` (1 caller, `freeChatSessionId`), both **LOW** risk.
Re-run before editing per the repo rules below.

---

## Phase 0 — Meta setup (manual, ~20 minutes)

1. developers.facebook.com → **Create app** → add the **WhatsApp** product. This
   creates a WhatsApp Business Account and a free test number.
2. **API Setup** panel: note the **test number's `phone_number_id`** (15–17 digits, not
   the phone number itself) and the **Graph API version** the panel shows. Pin that
   version in one constant in the code.
3. **Add the owner's personal WhatsApp number as a verified recipient** (up to 5
   allowed; one is enough). Meta sends a code to confirm it.
4. Send the pre-approved **`hello_world` template** with the curl snippet the panel
   gives you. It must arrive on the owner's phone. This proves token + number before
   any code exists. It has to be a template: the business cannot send free-form text
   until the user has messaged first (24-hour window — otherwise Graph returns
   **error 131047**).
5. **Reply to it from the phone.** That opens the 24-hour window, after which free-form
   sends work.
6. **Permanent token:** the dashboard token expires in 24 hours. In Business Manager →
   Settings → Users → **System Users**, create an admin system user, assign the
   WhatsApp asset, generate a token with `whatsapp_business_messaging` and
   `whatsapp_business_management`. Use that one.
7. **App secret:** App Settings → Basic → App Secret (32 hex). Used to verify webhook
   signatures.
8. **Verify token:** invent a random string. It goes in the dashboard and in the
   Worker's env; the two must match exactly.

Credentials, as env vars (never committed, never printed):

```
WHATSAPP_PHONE_NUMBER_ID=        # test number's id
WHATSAPP_ACCESS_TOKEN=           # system-user permanent token, starts EAA
WHATSAPP_APP_SECRET=             # 32 hex, signature verification
WHATSAPP_VERIFY_TOKEN=           # invented, must match the dashboard
WHATSAPP_ALLOWED_WA_ID=          # the one number allowed to talk, digits only, no +
WHATSAPP_AGENT_ID=               # which existing agent answers, during the spike only
```

Local: `agent/.dev.vars`. Staging: `wrangler secret put <NAME> --env staging`.
Read the values from `agent/.dev.vars` if needed; do not echo them into logs, tests,
commits, or this file.

---

## Phase 1 — the spike

Meta needs a **public HTTPS** callback, so the spike runs on the existing staging
Worker, not `wrangler dev`:

```
npm run deploy:staging          # runs typecheck + tests + preflight, then deploys
npx wrangler tail --env staging # watch inbound payloads
```

Webhook URL for the spike: `https://salt-agent-staging.dhairyashah98.workers.dev/whatsapp/webhook`
(no `:agentId` yet — the agent comes from `WHATSAPP_AGENT_ID`). Set it in the Meta
dashboard under WhatsApp → Configuration, with the verify token, and **subscribe to the
`messages` field**.

Do these in order; each step is separately verifiable.

**Step 1 — verify handshake.** `GET /whatsapp/webhook` with
`hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`. If the token matches, return
the raw `hub.challenge` value as `text/plain` 200; otherwise 403. Saving the callback
URL in the dashboard is the test.

**Step 2 — inbound lands.** `POST /whatsapp/webhook` logs the payload and returns 200.
Message the test number from the phone and watch `wrangler tail`. Confirm the
`x-hub-signature-256` header is present. Inbound shape:

```json
{
  "object": "whatsapp_business_account",
  "entry": [{ "id": "<WABA_ID>", "changes": [{ "field": "messages", "value": {
    "messaging_product": "whatsapp",
    "metadata": { "display_phone_number": "1555…", "phone_number_id": "<PHONE_NUMBER_ID>" },
    "contacts": [{ "profile": { "name": "Adam" }, "wa_id": "9199…" }],
    "messages": [{ "from": "9199…", "id": "wamid.HBg…", "timestamp": "1758…",
                   "type": "text", "text": { "body": "hello" } }]
  }}]}]
}
```

**Step 3 — signature check.** `sha256=<hex>` where the hex is HMAC-SHA256 of the
**raw request body** with the app secret. Read the body once as text and verify before
parsing — WebCrypto (`crypto.subtle.importKey`/`sign`) does this, no dependency needed.
Refuse mismatches with 401. A missing app secret must refuse too, not pass.

**Step 4 — echo.** Reply with fixed text to prove outbound:

```
POST https://graph.facebook.com/<VERSION>/<PHONE_NUMBER_ID>/messages
Authorization: Bearer <WHATSAPP_ACCESS_TOKEN>
Content-Type: application/json

{ "messaging_product": "whatsapp", "to": "<wa_id>", "type": "text",
  "text": { "preview_url": false, "body": "…" },
  "context": { "message_id": "<wamid of the message being answered>" } }
```

Typing + read receipt (optional, nice):

```json
{ "messaging_product": "whatsapp", "status": "read", "message_id": "<wamid>",
  "typing_indicator": { "type": "text" } }
```

**Step 5 — real turn.** Route into the existing session pipeline exactly as Telegram
does: resolve/create the session, then
`POST /agents/session-agent/<sessionId>/whatsapp` with the message, under
`ctx.waitUntil`, returning 200 immediately. Reuse `split()` for the 4096-character cap.

### Spike exit criteria

- Owner messages the test number from their phone and gets a real model answer in the
  same chat.
- A second person's `wa_id` (or a spoofed payload) gets no answer and no session.
- A replayed/retried delivery of the same `wamid` does not produce a second reply.

### Gotchas that will bite

- **Status callbacks.** `value.statuses` arrives for sent/delivered/read with no
  `messages` key. Ignore those early, or every reply triggers a fake turn.
- **Retries.** Meta re-delivers aggressively on non-200. Dedupe on `messages[0].id`
  (`wamid…`) — Telegram's code has no dedupe and doesn't need it; this does.
- **24-hour window.** Free-form replies only work within 24h of the user's last inbound
  message. Outside it, sends fail with **131047**. This breaks scheduled-task delivery
  (`deliverToChat`). For the spike, let it fail and log it. Phase 2 decides: store
  `last_inbound_at` and skip, or send a template nudge. Hermes, the reference
  implementation, simply lets cron fail here.
- **No groups.** Cloud API group messaging needs an Official Business Account and
  business-created groups of ≤8 people. Out of scope; `chat_thread_id` stays empty and
  there is no analogue to `telegram_group_whitelist`.
- **Media is two hops in, two calls out.** In: `GET /<VERSION>/<media_id>` returns a
  `url`, which must then be fetched **with the Bearer token**. Out: upload to
  `POST /<PHONE_NUMBER_ID>/media` (multipart, `messaging_product=whatsapp`) to get an
  id, then send `{"type":"image","image":{"id":…}}`. Media ids from webhooks expire
  after 7 days; 100MB ceiling. Skip media entirely in the spike.
- **Test-number ceiling.** Only the 5 verified recipients can be reached at all.

---

## Phase 2 — productionise

1. **`agent/src/whatsapp.ts`** — mirror of `telegram.ts`: `class WhatsApp { send,
   sendImage, typing, download }`, plus `verifySignature`, `messageOf(payload)`,
   `filesOf`, `chatTitle`. Move `split`, `whitelistEntries` and `allowedBy` out of
   `telegram.ts` into a shared module rather than copying them; keep the Telegram
   re-exports so nothing else has to change.
2. **Config columns** — append to `CONFIG_MIGRATIONS` (append-only, never reorder):
   `cap_whatsapp`, `whatsapp_phone_number_id`, `whatsapp_access_token` (secret),
   `whatsapp_app_secret` (secret), `whatsapp_verify_token`, `whatsapp_allowed_users`.
   Add the same keys to `Config`, `DEFAULT_CONFIG` (`cap_whatsapp: 0`) and
   `CONFIG_COLUMNS`. Add `last_inbound_at` to `SessionRow` for the window check.
3. **Session keying** — `sessionIdForChat` hardcodes `tg-`. Give it a channel argument
   (`wa-<wa_id>`), update `freeChatSessionId`, `handleWebhook`, the `!new` path at
   `agent/src/agent.ts:2246`, and `test/identity.test.ts`.
4. **Capability descriptor** — new entry in `CAPABILITIES` (`id: "whatsapp"`,
   `flag: "cap_whatsapp"`) with those fields and a `PLACEHOLDERS` entry. The frontend
   renders descriptors generically, so the settings UI appears for free. **Whitelist
   semantics differ from Telegram: empty means deny-all here.** Say so in the field
   hint and enforce it in code, not just the hint.
5. **Routes** — `GET|POST /whatsapp/webhook/:agentId` in the dispatch block
   (`agent/src/server.ts:2571`), a `handleWhatsappWebhook` beside `handleWebhook`, and
   an entry in the `/` route listing. No `syncWebhook` analogue exists: Meta's callback
   URL is set per app in the dashboard, so that stays a manual step. Consider a
   `GET /api/agents/:agentId/whatsapp/status` debug route mirroring the Telegram one at
   `agent/src/server.ts:2127`.
6. **Turn** — `whatsappTurn` in `agent.ts` mirroring `telegramTurn`: commands via
   `parseCommand`, `spendBlocked`, file ingest, reply, drawn images. Make
   `deliverToChat` channel-aware and window-aware.
7. **Spend** — every outbound WhatsApp message will be billed by Meta per message from
   1 Oct 2026 (service messages stop being free), and `split()` turns one long answer
   into several billable messages. Worth a note in the PR; a hard cap can come later.

### Tests (required — `npm run deploy` refuses on a red suite)

`test/` runs on `@cloudflare/vitest-pool-workers`. The suite is network-sealed:
`test/openrouter-mock.ts` is wired as miniflare's `outboundService` and **503s anything
that is not OpenRouter** (see the "network seal" test in `test/turn.test.ts:397`). So
extend that mock to stub `graph.facebook.com`, or WhatsApp sends fail in tests.

Cover: verify handshake (match and mismatch), signature accept/reject, missing app
secret refuses, `statuses`-only payload is a no-op, duplicate `wamid` replies once,
whitelist denies an unknown `wa_id` and denies when empty, session id stability for a
`wa_id`, 4096-char split, and the >24h window path.

---

## Repo rules that apply to this work

- `impact({target, direction: "upstream"})` before editing any function — never grep as
  a substitute. Treat `risk: UNKNOWN` as unresolved, not as safe.
- `detect_changes({scope: "all"})` before committing. `partial`/`truncated` is not a
  clean check.
- Tests land with the behaviour. No Playwright. No unrequested extras.
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Deferred decisions

- Window-expiry behaviour for scheduled tasks: silently queue, or approved template
  nudge ("update ready, reply to continue") then free-form the real answer.
- Whether to keep creds in agent config (per-agent, like Telegram) or in Worker
  secrets. Phase 2 assumes per-agent config; the spike uses env vars.
- No-train provider pinning for WhatsApp turns — required by Meta's terms, not yet
  implemented anywhere in the codebase.
