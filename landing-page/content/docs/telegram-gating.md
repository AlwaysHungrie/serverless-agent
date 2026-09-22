---
title: Who may talk to your bot
section: Everyday use
order: 4
summary: Whitelists decide who gets an answer and where. They start closed; an empty list allows everyone, including strangers who bill your OpenRouter key.
---

Your bot's username is public. Anyone who learns it, guesses it, or finds it in a
group you both belong to can press Start and begin a conversation billed to your
OpenRouter key, in a session that then sits in your sidebar.

The whitelists are how you stop that. There are two, both under
**Capabilities → Telegram**.

## The rule

**An empty list allows everyone.** A list with entries allows only those entries.

Because of that, the first time you switch Telegram on both lists are filled with
placeholders that match nobody:

```
@no-user
-1000000000000
```

Your bot is closed until you replace them. Delete the placeholder, add the people and
groups the bot is really for, and leave nothing else behind. If you empty a list
completely, you have opened it to all of Telegram, so do that only on purpose.

A message from someone not on the list is dropped in silence. There is no bounce
message, no session created, and nothing charged. They cannot tell the difference
between a bot that is ignoring them and a bot that does not exist.

## The DM whitelist

Who may message the bot privately. One entry per line. An entry is a Telegram username,
with or without the `@`:

```
@alice
@bob
```

A numeric Telegram user id works too, and is the sturdier choice for someone who changes
their username.

You can also write a pattern by wrapping it in slashes. This allows every username that
starts with `team_`:

```
/^team_/
```

## The group whitelist

Which groups, and which topics inside them, the bot answers in. Entries are chat ids,
not names:

```
-1001234567890
-1001234567890:42
```

The first line allows a whole group. The second allows **only topic 42** of that group,
which is how you let the agent into one channel of a busy workspace without it being
reachable everywhere.

Patterns work here too:

```
/^-100123456789[0-9]$/
```

### Finding the ids

Add [@userinfobot](https://t.me/userinfobot) to the group and it will tell you the group
id, and the topic id if you message it inside a topic. Group ids are negative numbers
beginning `-100`; write them exactly as given.

## Two gates, not one

Being allowed in is separate from being spoken to. Even in a whitelisted group, the bot
answers only messages that **mention it** by username. So a group chat carries on
normally and the agent stays quiet, costing nothing, until somebody types
`@ada_salt_bot`.

In a direct message everything is addressed to the bot, so the DM whitelist is the whole
of the gate.

## Why it's worth setting up

- **Money.** Every answer spends your OpenRouter credit, and an open bot means anyone can
  spend it.
- **Privacy.** Your agent has memories, connected tools and possibly your Notion. A
  stranger talking to it is talking to those things.
- **Noise.** Unwanted chats become sessions, and sessions have a limit.

Set the lists when you connect the bot, before you tell anyone its name.

## A sensible starting point

- **Just me:** your own username in the DM list, one placeholder left in the group list.
- **Me and my team:** everyone's usernames in the DM list, the one work group id in the
  group list.
- **A public-ish bot:** empty DM list, and a spending limit on OpenRouter you would be
  content to lose. Know what you are doing before you choose this.

## What next

- [Give your agent a Telegram account](/docs/telegram-bot)
- [Who can manage your agent](/docs/access)
