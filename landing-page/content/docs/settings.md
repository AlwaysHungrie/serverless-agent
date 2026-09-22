---
title: Settings that change how it answers
section: Control and access
order: 1
summary: Model, instructions, reasoning, creativity, reply length and context window: what each one does and what to set it to.
---

Everything on the **Settings** page changes how the agent talks. Capabilities change what
it can do; these change what it is like.

## Model

Which model answers you. The default is cheap and quick and fine for chat. Move up when
answers feel shallow, when a task needs care, or when you want to send images. The list
marks which models can see.

Changing the model takes effect on your next message. Nothing in the conversation is
lost, so it is reasonable to switch mid-session for one hard question and switch back.

## Custom instructions

The most valuable field on the page, and the one most people leave empty. It is appended
to the agent's instructions on every message, in every session, on every surface.

Write how you want it to reply, not what it should be:

```
Answer in short paragraphs, no bullet lists unless I ask.
Give me the answer first and the reasoning after.
If you are guessing, say so.
Use British spelling.
I'm in Lisbon, so use CET for times.
```

Three to six lines is usually enough. It is also where you correct a standing annoyance:
if it keeps searching the web when it should not, or never searches when it should, say
so here rather than in every conversation.

## Extended reasoning

How long the model thinks before it starts answering.

| Setting | Use |
|---|---|
| Off | Ordinary chat. Fastest and cheapest — the default |
| Low | A brief pause before answering |
| Medium | Multi-step questions, planning, comparisons |
| High | Hard problems where you would rather wait |

Thinking is billed as tokens, so high reasoning on ordinary chat wastes money. Leave it
off and raise it only for the session where it matters.

## Creativity

Low keeps answers literal and repeatable. High makes them varied and more willing to
wander. The middle is a reasonable default. Turn it down for anything factual; turn it up
for brainstorming and names.

## Reply length cap

A ceiling on a single reply. Left at no cap, the model stops when it is finished, which
is usually right. Set a cap when you want deliberately short answers. A cap is a hard
stop, so an answer can end mid-sentence when it hits one.

## Context window

How much of the conversation is re-sent with each message. The default sends the whole
thing, which is what makes long sessions expensive.

Setting a cap, say the last 20 or 30 messages, stops the cost growing in a session you
want to keep going for a long time. The trade is that the agent genuinely forgets what
was said earlier in that conversation.

For most people, [starting a new session](/docs/sessions) is the better tool. The cap is
for a single long-running chat you do not want to break up.

## OpenRouter key

Where the agent's key lives. A saved key reads back as `••••••••`; save that mask
unchanged and the existing key is left alone. Paste a new key to replace it; it is
checked before it is saved.

## Name

What the agent is called, in the app and in its own instructions. Changing it changes how
it refers to itself.

## What next

- [Who can manage your agent](/docs/access)
- [Sessions, and when to start a new one](/docs/sessions)
