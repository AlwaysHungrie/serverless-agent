---
title: Give your agent a Telegram account
section: Start here
order: 4
summary: Make a bot with @BotFather, connect it in two fields, and understand how DMs, groups and forum topics map onto conversations.
---

Telegram is optional (the web app can do everything), but it is how most people actually
use their agent. The bot is a real Telegram account: you message it, you forward things
to it, you add it to a group, you hold the mic and talk.

One bot belongs to one agent. If you run two agents, make two bots.

## Get the token

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Give it a **display name**: what people see, for example `Ada`.
4. Give it a **username**: it must be unique across Telegram and must end in `bot`, for
   example `ada_salt_bot`.
5. BotFather replies with a token that looks like `8412345678:AAH…`. Copy it.

Keep the token private. Anyone holding it can act as your bot.

While you are there, two optional settings worth doing:

- `/setdescription`: the text people see before they press Start.
- `/setprivacy`: leave privacy **enabled** (the default). With privacy on, your bot only
  sees messages in a group that mention it, which is both cheaper and less alarming to
  the group.

## Connect it

In Salts, open **Capabilities → Telegram** and fill in two fields:

- **Bot token**: what BotFather gave you.
- **Bot username**: the `@name` you chose. The agent needs it to recognise mentions in
  groups.

Save. The connection to Telegram is made for you at that moment. There is no webhook to
configure and no address to copy anywhere.

Switching the Telegram capability off later disconnects the bot cleanly; switching it
back on reconnects it.

## Before you share the bot's name

**The whitelists start closed.** The first time you switch Telegram on, the DM and group
lists are filled with placeholder entries that match nobody, so a stranger who finds your
bot gets silence rather than a conversation billed to your key.

Replace them with the people and groups it is really for. That is
[Who may talk to your bot](/docs/telegram-gating), and it is the next thing to read.

## How chats become conversations

| Where you talk | What the agent sees |
|---|---|
| A direct message | One session, ongoing |
| A group chat | One session for the whole group |
| A forum topic | One session per topic |

In a **direct message** everything you send is for the bot.

In a **group**, it answers only when the message names it: `@ada_salt_bot, what did we
decide?`. It ignores everything else, so it can sit in a busy channel without spending
your money on every message.

In a **forum** (a group with topics), each topic is its own conversation with its own
history. That is usually what you want: one topic for travel, one for invoices.

Replies carry context. If you reply to somebody's message when you mention the bot, the
quoted message is passed along with your question, so "@ada is this right?" makes sense.

## What you can send it

Anything the matching capability allows: text, forwarded messages, photos, screenshots,
PDFs, documents and voice notes. The agent needs **File ingest**, **Image input** or
**Audio input** switched on for those to be read. See
[Files, photos and voice notes](/docs/files-and-media).

Long answers are split across several messages, because Telegram refuses anything over
4096 characters. Nothing is lost.

## The same conversation, both places

A Telegram chat shows up in the web app's sidebar like any other session, with the full
transcript and the cost of every reply. You can read there what was said on your phone,
and carry on from either side.

## If the bot goes quiet

Work through [When something breaks](/docs/troubleshooting). Nine times out of ten it is
a whitelist that has not been updated yet, or a missing mention in a group.

## What next

- [Who may talk to your bot](/docs/telegram-gating)
- [Commands](/docs/commands)
