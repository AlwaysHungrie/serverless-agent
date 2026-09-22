---
title: Quickstart
section: Start here
order: 2
summary: From nothing to a working agent in about ten minutes, with the two keys you need and the first four settings worth changing.
---

This is the short path. Every step has a longer article behind it if you get stuck.

## 1. Get an OpenRouter key

Create an account at [openrouter.ai](https://openrouter.ai), add a little credit, set a
monthly spending limit, and create an API key. It starts with `sk-or-v1-`.

The spending limit is the important part: it is your ceiling, and it is set on
OpenRouter rather than here. Full walkthrough:
[Get an OpenRouter key](/docs/openrouter-key).

## 2. Create your agent

Sign up, click **New agent**, give it a name and paste the key. The key is checked
before the agent is created, so a typo fails here rather than on your first message.

Say hello in the web chat. If it answers, the agent is working.

## 3. Give it a Telegram account (optional)

Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`, answer the two
questions, and copy the token it gives you. In Salts, open **Capabilities → Telegram**,
paste the token and the bot's `@username`, and save. The bot is wired up the moment you
save.

**Then fix the whitelists before you tell anyone the bot's name.** They start closed on
purpose. See [Who may talk to your bot](/docs/telegram-gating).

## 4. Turn on the capabilities you actually want

Open **Capabilities** and start with these three:

- **Read a URL**: needs nothing, and makes "what does this page say?" work.
- **Private memory**: lets it keep facts about you between conversations.
- **Web search**: needs a Brave Search API key, or a SearXNG instance of your own.

Leave the rest off until you need them. Each one adds tools to every turn, which costs
tokens. See [Capabilities](/docs/capabilities).

## 5. Tune two settings

Open **Settings**:

- **Model**: the default is cheap and fast. If answers feel thin, move up a model.
  Sending images needs a model that can see; the list says which ones can.
- **Custom instructions**: three lines on how you want it to reply. This is the
  highest-value setting in the product and the one people skip.

## 6. Learn the three commands

Type these as a whole message, in the web app or on Telegram:

| Command | What it does |
|---|---|
| `!new` | Move a Telegram chat onto a fresh session, keeping scheduled tasks |
| `!unstick` | Clear a wedged turn without losing the conversation |
| `!delete` | Delete this session and everything in it |

See [Commands](/docs/commands).

## What next

- [Sessions, and when to start a new one](/docs/sessions): the habit that keeps costs down.
- [Connect an MCP server](/docs/mcp-servers): Notion, and everything else.
- [What it costs](/docs/costs): how the numbers under each message work.
