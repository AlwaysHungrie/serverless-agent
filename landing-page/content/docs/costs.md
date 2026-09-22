---
title: What it costs
section: Limits and costs
order: 2
summary: Why the product is free, what you actually pay for, how to read the numbers under each reply, and the four things that drive the bill.
---

Salts is free to run. You pay two other people, sometimes:

- **OpenRouter**, for model tokens. This is the only cost most people ever have.
- **A connected service**, if it charges: a Brave Search plan, or a product whose MCP
  server sits behind a paid account.

There is no subscription here, no credits to expire, and nothing to cancel.

## Why it works this way

Handing us $20 a month would mean we decide what you may spend it on and which model you
get. Bringing your own key means you set the ceiling, you pick the model, and a month
where you barely use the agent costs you almost nothing.

## Reading the numbers

Every assistant message shows tokens in, tokens out, and dollars. The session header
totals the conversation.

Those figures are what OpenRouter charged for that exact call, not an estimate. The
resources the agent itself uses, such as being online, holding your conversations, and
waking up for a scheduled task, are not shown, because they are ours and they are tiny:
a message costs us a few hundredths of a cent.

## What actually drives the bill

In order of impact:

1. **Session length.** Every message re-sends the conversation. This is, by a distance,
   the most common reason someone's spend looks wrong. [Start new
   sessions](/docs/sessions).
2. **Model choice.** The gap between the cheapest and most capable model is a factor of
   twenty or more. Use a cheap one for chat and switch up for hard questions.
3. **Extended reasoning.** Thinking is billed. Leave it off unless a task needs it.
4. **Tools and images.** Each tool switched on is described on every message; generating
   an image costs many times a text reply; searching adds the pages it reads.

## Keeping it low

- Set a monthly limit on your OpenRouter account, and per-key limits if you run more than
  one agent.
- Start a new session when the subject changes. Fork rather than argue.
- Keep only the capabilities and MCP servers you use switched on.
- Use **Stop** on an answer that has gone wrong, instead of reading to the end.
- Check the **Activity** page on OpenRouter after your first week; it shows every call by
  model.

## A rough shape

For one person using a cheap model for everyday chat, spend lands in the small number of
dollars a month. Heavy use of a frontier model with reasoning on, long sessions and
image generation can be an order of magnitude more. Both are entirely under your control,
and the limit you set on OpenRouter is the backstop.

## What next

- [Usage limits](/docs/usage-limits)
- [Get an OpenRouter key](/docs/openrouter-key)
