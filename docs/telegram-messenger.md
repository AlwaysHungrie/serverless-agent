# Telegram messenger agent

`MessengerAgent` (`agent/src/messenger-agent.ts`) is a [Think](https://www.npmjs.com/package/@cloudflare/think)
agent that owns the Telegram bot. It runs beside `SessionAgent`, not instead of it:
the browser sessions keep their own Durable Object, their own transcript, and their
own REST surface.

What the two share is the registry object. `MessengerAgent` rereads the settings row
at the start of every turn, so the model, system prompt, temperature, token cap and
capability toggles set in the settings panel apply to Telegram with no deploy.
Capability tools are wrapped for the AI SDK from the same `TOOLS` table, so a tool
added in `capabilities.ts` reaches the bot for free.

## Conversation shape

The messenger is configured with `conversation: "self"`, so every Telegram chat and
the `/messenger` page in the frontend write into one conversation. Change it to the
default (one sub-agent per Chat SDK thread) if a group chat should not see what a DM
said:

```ts
telegramMessenger({ /* ... */ });        // one sub-agent per thread
telegramMessenger({ conversation: "self" }); // one shared conversation
```

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather); keep the token and the
   handle.
2. Put the handle in `wrangler.jsonc` under `vars.TELEGRAM_BOT_USERNAME` (no `@`).
3. Set the secrets:

   ```sh
   cd agent
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET_TOKEN   # any random string
   ```

4. Deploy, then point Telegram at the Worker. The secret token is what makes the
   webhook trustworthy — Think rejects any POST that does not carry it.

   ```sh
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -H 'content-type: application/json' \
     -d '{"url":"https://<worker-host>/messengers/telegram/webhook","secret_token":"<WEBHOOK_SECRET>"}'
   ```

The Worker forwards `/messengers/*` to the single root agent instance (`default`);
Think verifies the signature, routes the event, and streams the reply back into the
chat by editing the message it posted.

## Durable Objects

Two new classes, both in migration `v3`:

- `MessengerAgent` — the Think agent itself.
- `ThinkMessengerStateAgent` — Chat SDK state (subscriptions, locks, queues, dedupe
  keys, thread history). Facet-only state; it is exported and bound so sub-agent
  routing can resolve it.

## Known gaps

- Voice notes: the transcription tool has no session attachment to read, so it
  reports that audio is unavailable over chat.
- Generated images are written to R2 under `messenger/<agent>/<id>` and handed to
  the model as a `/messengers/files/...` path. That route is not served yet, so the
  link is a placeholder until image delivery is wired to the Telegram adapter.
- Discord: `@chat-adapter/discord` exists, but Think ships no Discord messenger
  helper. It would go through `chatSdkMessenger()` with an Ed25519 `verifyWebhook`.
