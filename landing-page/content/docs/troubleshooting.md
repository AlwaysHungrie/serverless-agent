---
title: When something breaks
section: When something breaks
order: 1
summary: The failures people actually hit, in the order they hit them, with the fix for each.
---

## The agent will not answer at all

**"No API key" or an error mentioning credits.** Open **Settings → OpenRouter**. Either
no key is saved, the key was revoked, or the OpenRouter account has hit its balance or
its monthly limit. Top up or raise the limit at
[openrouter.ai](https://openrouter.ai/settings/keys), and paste a fresh key if in doubt.

**A `401` from the provider.** The key is wrong or has been deleted. Create a new one.

**A `402`, or "quota".** Money. Same page.

## The Telegram bot is silent

In this order:

1. **Is the sender on the DM whitelist?** The lists start closed, filled with
   placeholders that match nobody. This is the cause most of the time. See
   [Who may talk to your bot](/docs/telegram-gating).
2. **In a group, was the bot mentioned?** It answers only messages naming it:
   `@your_bot, …`. It ignores everything else on purpose.
3. **Is the group, or the topic, on the group whitelist?** A forum topic can be
   allowed on its own, and a group allowed elsewhere is not allowed here.
4. **Is the Telegram capability on, with both fields filled?** It needs the bot token
   *and* the bot username; the username is how mentions are recognised.
5. **Is the token still valid?** Regenerating a token in @BotFather invalidates the old
   one. Paste the new one and save; saving reconnects the bot.

## It answers in the wrong place in a group

Each forum topic is its own conversation. If replies are landing in the group's General
topic, the message was sent there. Check which topic you are typing in.

## The conversation is stuck

Send `!unstick`. It clears the stuck turn and keeps everything: transcript,
attachments, scheduled tasks. Then ask again.

If it happens repeatedly in one conversation, that session is usually very long. Start a
new one, or fork from a good message.

## Images fail

Two causes:

- **The model cannot see.** Under **Settings → Model**, the list marks which models
  accept images. The cheap default does not.
- **The capability is off.** **Capabilities → Image input**.

For generated images, check **Capabilities → Image generation** has an image model
selected.

## Voice notes are ignored

**Capabilities → Audio input** must be on and must have a transcription model chosen.
Clips over 25 MB are refused.

## A file will not attach

Check it against the ceilings: 1 MB for text and code, 8 MB for PDFs, 10 MB for images,
25 MB for audio, and four files per message. Also check **File ingest** is on. See
[Files, photos and voice notes](/docs/files-and-media).

## Web search returns nothing

There must be either a Brave API key or a reachable SearXNG URL. If both are set, the
Brave key wins and SearXNG is ignored. A SearXNG instance must be reachable from the
internet and must have JSON output enabled. See [Web search](/docs/web-search).

## An MCP server has stopped working

The card shows the reason.

- **Unauthorised / token expired**: press **Connect** again to re-approve OAuth, or
  paste a new key for a header-authenticated server.
- **Tools missing after a provider update**: press **Refresh** to re-read the tool list.
- **Cannot connect**: check the URL, and that the server is a remote one. A server
  running on your own machine needs a tunnel or a host. See
  [Connect another agent](/docs/external-agents).

## Answers have got slow, expensive or vague

This is almost always session length. Every message re-sends the conversation, so a long
one is slower, dearer and more distracted with every turn. Start a new session, or fork
from the last good message. See [Sessions](/docs/sessions).

## "Too many sessions"

256 per agent. Delete what you have finished with (the sidebar has a search box), or
send `!delete` inside a Telegram chat you no longer want. See
[Usage limits](/docs/usage-limits).

## Something else

If the agent behaves in a way none of this explains, the fastest answer is usually to
start a fresh session and try the same thing there. If it works in the new session, the
old transcript was the problem. If it does not, it is a setting, and Settings and
Capabilities are the two pages to check.
