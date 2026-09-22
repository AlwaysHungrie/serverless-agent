---
title: Usage limits
section: Limits and costs
order: 1
summary: What is capped, what happens when you reach a cap, and how to get more room.
---

Running Salts is free, which is possible because the limits are real. They are generous
for one person and they are not negotiable on a free account. If you need past them,
[host it yourself](/docs/self-hosting).

## The limits

| Limit | Value |
|---|---|
| Agents | 1 per person |
| Sessions per agent | 256 |
| Messages per session | Up to 128 MB of transcript |
| Files stored | 50 MB per account |
| Files per message | 4 |
| Tool rounds per reply | 6 |
| Connected MCP servers | No limit |
| Capabilities | No limit |

Your model spend is not limited by us at all. That is between you and OpenRouter, and
the cap you set there is the only one.

## Sessions

256 conversations is a lot, but a Telegram bot active in several groups can reach that
faster than expected. When you get close, delete the ones you have finished with: the
sidebar has a search box, and deleting one takes its messages and attachments with it.

`!delete` does the same thing from inside a conversation, which is the quick way to clear
a Telegram chat you no longer want.

## Transcript size

A single session holds up to 128 MB of messages, which is far more conversation than
anyone has. You will find the cost of a long session objectionable long before you find
its ceiling. See [Sessions](/docs/sessions) for why, and what to do instead.

## Storage

Attachments, such as photos, PDFs, voice notes, and generated images, count against
50 MB per account. Deleting a session deletes its files, which is the way to free space.

Text and transcripts are not the constraint here; a few dozen PDFs are.

## Tool rounds

Within one reply the agent may use up to six rounds of tools before it has to answer.
That covers searching, reading a couple of results and replying. A task genuinely needing
more should be broken into two messages, which is cheaper and easier to follow anyway.

## Getting more room

Two ways:

- **Delete things.** Old sessions and their attachments, which costs nothing and takes a
  minute.
- **Host it yourself.** On your own Cloudflare account there are no session, agent or
  storage limits. You pay Cloudflare for what you use, which is very little. See
  [Host it yourself](/docs/self-hosting).

If you need many agents for other people rather than more room for yourself, that is a
business account. See [Who can manage your agent](/docs/access).

## What next

- [What it costs](/docs/costs)
- [Host it yourself](/docs/self-hosting)
