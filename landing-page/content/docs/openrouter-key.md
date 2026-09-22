---
title: Get an OpenRouter key
section: Start here
order: 3
summary: Create an OpenRouter account, put a ceiling on what it can spend, and copy the key your agent needs to think.
---

OpenRouter is a single account that reaches hundreds of models from every major lab. Your
agent calls it with your key, and OpenRouter bills you for exactly the tokens used. There
is no subscription in the middle, no credits to expire, and nothing to cancel.

Your agent cannot answer without this key. It is the one required step.

## Create the account

1. Go to [openrouter.ai](https://openrouter.ai) and sign up.
2. Open **Credits** and add a starting balance. Ten dollars is plenty to begin with;
   ordinary chatting on a cheap model runs to a few cents a day.

Credit is spent as you use it. An idle agent costs nothing.

## Set a spending limit first

Before you create a key, open **Settings → Limits** and set a monthly cap on the
account. This is your real ceiling and it lives on OpenRouter, not here, so nothing
you do in Salts, and nothing your agent does on its own, can spend past it.

Do this even if you trust yourself. A scheduled task that runs more often than you meant,
or a very long conversation you forgot to end, both spend money while you are asleep.

## Create the key

1. Open [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).
2. Click **Create key** and name it something you will recognise later, like
   `salts-personal`.
3. Optionally give the key its own credit limit, separate from the account's. If you run
   more than one agent, a limit per key keeps one from eating the other's budget.
4. Copy the key. It looks like `sk-or-v1-…` and it is shown **once**.

Paste it into Salts when you create the agent, or later under **Settings → OpenRouter**.
The key is validated at the moment you save it, so an invalid key tells you immediately
instead of failing on your first question.

## Choosing models

Your agent's model is picked under **Settings → Model**. Everything in that list is an
OpenRouter model id, and the ones on offer are:

| Model | Good for | Can see images |
|---|---|---|
| DeepSeek V4 Flash | The default. Cheap, fast, fine for most chat | No |
| Claude Haiku 4.5 | Careful writing and reasoning at low cost | Yes |
| GPT-5 Mini | A balanced general-purpose alternative | Yes |
| Gemini 2.5 Flash | Long inputs, quick answers | Yes |

Two things to know:

- **Image input needs a model that can see.** If you send photos, pick one of the models
  marked yes. A model that cannot see an image fails at the provider, not at the upload.
- **Some capabilities call their own model.** Image generation and voice-note
  transcription each pick a model in their own settings, billed to the same key. See
  [Files, photos and voice notes](/docs/files-and-media).

## Watching the spend

Two places show you the truth:

- **In Salts**: every assistant message shows its tokens and its cost, and the session
  header totals the conversation.
- **On OpenRouter**: the **Activity** page lists every call your key made, by model.

If a number surprises you, the usual cause is a long session rather than an expensive
model. [Sessions, and when to start a new one](/docs/sessions) explains why.

## If the key stops working

- `402` or "credits" in an error means the balance or a limit is exhausted. Top up, or
  raise the cap.
- `401` means the key was revoked or mistyped. Create a new one and paste it again.
- A saved key reads back as `••••••••`. That mask means "a key is set", and saving the
  mask unchanged leaves the existing key alone.

## What next

- [Give your agent a Telegram account](/docs/telegram-bot)
- [What it costs](/docs/costs)
