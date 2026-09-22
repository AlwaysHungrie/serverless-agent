---
title: How Salts works
section: Start here
order: 1
summary: An overview of the agent, its keys, sessions, capabilities and connections.
---

Salts gives you one agent that is always online. You talk to it in the web app, or on
Telegram, or both. It is the same agent either way, with the same memory, the same
settings and the same tools.

It runs on somebody else's computers and it never sleeps, but it has no model of its
own. The thinking is done by a model you choose and pay for directly. We run the agent
for free; you bring the model and pay for what it uses.

## The agent

An agent is a name, a set of settings, a set of tools, and everything it has ever been
told. Agents share nothing with each other. Each has its own model key, its own Telegram
bot, its own connected tools, its own memories and its own conversations.

Most people need exactly one. You would create a second one to keep a work agent and a
personal agent apart, or to hand an agent to someone else with different tools switched
on.

## The two keys

Your agent needs one key and can use a second.

- **An OpenRouter key**, required. It is how the agent reaches a model, and it is what
  the model charges. No key, no answers. See [Get an OpenRouter key](/docs/openrouter-key).
- **A Telegram bot token**, optional. It gives your agent its own Telegram account, so
  you can message it like a person and add it to group chats. See
  [Give your agent a Telegram account](/docs/telegram-bot).

Everything else is a switch you flip later.

## Sessions

A session is one conversation. In the web app it is one row in the sidebar; on Telegram
it is one chat, or one topic inside a group chat. Each of those is a session of its
own.

Sessions matter more than they look. A session carries its whole history into every new
message, so a long-running one gets slower and more expensive with each reply. Starting
a fresh session for a new subject is the single most useful habit with this product. See
[Sessions, and when to start a new one](/docs/sessions).

## Capabilities

Out of the box your agent can read and write text. Everything beyond that is a
capability you switch on under **Capabilities**: web search, reading a link, reading a
file, looking at an image, drawing one, listening to a voice note, remembering facts,
scheduling work for later.

Each one is off until you turn it on, and some need a key or a model of their own. See
[Capabilities](/docs/capabilities).

## Connections

Capabilities are what we built. Connections are everything else: Notion, your own
tools, another team's agent, reached over MCP, an open standard for handing tools to an
AI agent. Add a server, approve it, pick which of its tools your agent may call. See
[Connect an MCP server](/docs/mcp-servers).

## What it costs

Running the agent is free. You pay OpenRouter for model tokens, and you pay for any
connected service that has a price of its own. Every reply shows what it cost, to the
cent, next to the message. See [What it costs](/docs/costs) and
[Usage limits](/docs/usage-limits).

## Where to go next

1. [Quickstart](/docs/quickstart): a working agent in about ten minutes.
2. [Get an OpenRouter key](/docs/openrouter-key): the one required step.
3. [Give your agent a Telegram account](/docs/telegram-bot): optional, ten minutes.
