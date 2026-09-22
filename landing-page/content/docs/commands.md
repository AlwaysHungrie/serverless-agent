---
title: Commands
section: Everyday use
order: 3
summary: Three things you say to the session itself rather than to the agent, and why they still work when nothing else does.
---

Commands are handled by the conversation, not by the model. That matters: a session that
has got itself stuck cannot answer a question about itself, and a Telegram chat has no
buttons to press. Commands work in both cases, because they never reach the model at
all.

They cost nothing. No tokens are spent running one.

## The three commands

| Command | What it does |
|---|---|
| `!new` | Hands this chat to a brand new session. Scheduled tasks move across |
| `!unstick` | Clears a stuck turn. The conversation and everything in it is kept |
| `!delete` | Deletes this session and everything in it |

## How to type one

The command has to be the **whole message**. `!delete` deletes the session; "should I
use !delete here?" does not. That is deliberate: finding out how the feature works
should not cost you the conversation.

In a group chat you have to mention the bot to reach it at all, so a leading or trailing
`@yourbot` is fine and is ignored:

```
@ada_salt_bot !new
```

## `!new` — start a clean conversation

Use this on Telegram when you change subject. The chat stays where it is; what changes
is the session behind it. The old transcript stops being re-sent, so the next answer is
cheaper, faster and more focused.

Anything you had scheduled in that chat is moved onto the new session, so a daily
reminder keeps arriving.

In the web app there is a new-chat button, so `!new` is mostly a Telegram tool. Sent in
a web session that is not tied to a chat, it says so and does nothing.

## `!unstick` — get a wedged session moving

Very occasionally a turn does not finish. A model call never returns, or a network
failure hits at the wrong moment, and the session believes it is still busy. `!unstick`
clears that state.

Nothing is lost: the transcript, the attachments, the scheduled tasks and the memories
are all still there. Ask your question again.

Try this before `!delete`. It solves the same symptom without the cost.

## `!delete` — remove the session

This deletes the conversation, its messages, its uploaded files and its scheduled tasks.
It cannot be undone.

On Telegram, the next message you send starts a fresh conversation in the same chat, as
if the bot had just met you. Memories the agent stored about you are not touched:
those belong to the agent, not the session.

Use it for a conversation you would rather did not exist, or to free a slot when you are
near the session limit.

## What next

- [Sessions, and when to start a new one](/docs/sessions)
- [When something breaks](/docs/troubleshooting)
