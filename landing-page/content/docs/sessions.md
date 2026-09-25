---
title: Sessions, and when to start a new one
section: Everyday use
order: 2
summary: Why one long conversation gets slow, expensive and forgetful, and the habit that fixes all three.
---

A session is one conversation. In the web app it is one row in the sidebar. On Telegram
it is one chat, or one topic inside a group.

Each session is a separate, isolated thing with its own transcript, its own attachments
and its own scheduled tasks. Deleting one takes all of that with it and touches nothing
else.

## Why a new session matters

Models have no memory of their own. To answer your next question, the agent re-sends the
conversation so far and then asks the model to read all of it again.

That has three consequences, and they get worse together:

1. **Cost rises with every message.** You are not paying for your one-line question, you
   are paying for the whole conversation, every time. A 200-message session can cost
   ten times what the same question costs in a fresh one.
2. **Answers get slower.** More to read means more to wait for.
3. **Quality drops.** A long transcript full of unrelated subjects buries the part that
   matters. Old, abandoned threads pull answers off course.

So: **one subject, one session.** Finished planning the trip and want to talk about
invoices? Start a new session. Of everything in this product, that habit does the most
to keep cost down.

## What a new session does not lose

Starting fresh is not starting over.

- **Memories survive.** Facts the agent has stored about you belong to the agent, not to
  the conversation, and are available in every session. That is what
  [Memory](/docs/memory) is for.
- **Settings survive.** Model, instructions, capabilities and connected tools are all
  agent-wide.
- **Nothing is deleted.** The old session stays in the sidebar until you delete it.

What is left behind is the transcript, which is exactly the thing you wanted to stop
paying for.

## How to start one

- **In the web app**: the new-chat button above the session list.
- **On Telegram**: send `!new`. The chat carries on in the same place, on a clean
  session. Anything you had scheduled moves across with it. Send `!clear` instead to
  delete the conversation you are leaving.

## Limiting how much is re-sent

If you want long sessions anyway, **Settings → Context window** caps how many past
messages are sent with each turn. Set it to, say, the last 20 messages and the cost
stops growing, at the price of the agent forgetting what was said earlier in that
conversation.

It is a blunt instrument. Starting a new session is usually the better answer.

## Forking instead of arguing

If a conversation has gone off the rails, fork it from the last good message rather than
correcting the agent in place. You get a new session containing everything up to that
point, with your question ready to be rewritten and none of the mess after it.

## Housekeeping

You can keep **256 sessions** per agent. Delete the ones you are finished with; the
sidebar has a search box for finding the ones you are not. See
[Usage limits](/docs/usage-limits).

## What next

- [Commands](/docs/commands)
- [Memory](/docs/memory)
