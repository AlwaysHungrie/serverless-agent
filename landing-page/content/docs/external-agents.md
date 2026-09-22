---
title: Connect another agent
section: Connect other tools
order: 2
summary: Hubs, your own servers, other teams' agents, and the three ways of putting two agents in touch.
---

Anything that speaks MCP can be plugged into your agent, including other agents. This
page covers the arrangements people actually use, and the limits worth knowing before
you plan around them.

## What can be connected

Your agent connects to **remote MCP servers over HTTP**. If a thing has a URL and speaks
MCP, it can be a tool.

What cannot be connected directly is a server that runs as a local process on your own
computer, the kind installed with `npx` and wired into a desktop app. There is nothing
at an address for the agent to call. Two ways round it:

- **Tunnel it.** `cloudflared tunnel --url http://localhost:3000` gives a local server a
  public address in one command. Good for trying something out; the address changes each
  run.
- **Host it.** Run the server on a small box or a Cloudflare Worker and give it a
  permanent address and a key.

## A hub, instead of ten servers

If you use many MCP servers, an aggregator like **MetaMCP** puts them behind one address
with one key. You connect that single server to your agent and manage the collection in
the hub.

Set it up as an **API key** server: the hub's address in the URL, and its key as an
`Authorization` header. The tools of everything inside it then appear in your agent as
one list.

The same trade applies as always: every tool the hub exposes is described to the model on
every message. Prune inside the hub, or with the per-tool switches on the card.

## Another team's agent, as a tool

Some agent products expose themselves over MCP: a research agent, a coding agent, a
support agent your company runs. Connect it like any other server, usually with an API
key header, and your agent gains its abilities as tools it can call mid-conversation:
ask yours a question, it asks theirs, it answers you.

This is the cleanest way to specialise. Rather than loading one agent with everything,
keep yours as the one you talk to and let it delegate.

## Your own server

If you have an internal API, a database or a script you want your agent to use, writing a
small MCP server is a short job: Cloudflare's own template runs one on a Worker with a
key in a header. Then it is just another connection.

Two things to get right:

- **Describe each tool well.** The description is how the model decides whether to call
  it. "Returns invoice totals for a customer id" beats "invoice endpoint".
- **Keep the destructive ones separate**, so they can be switched off on the card without
  losing the useful ones.

## Two agents in one room

The simplest agent-to-agent setup does not use MCP at all. Put two bots in one Telegram
group and mention them both. Each answers only when addressed by name, in the same
thread, and a human directs the conversation.

This suits a second opinion. It does not suit anything automated: the agents do not take
turns and will not converse without a human tagging them each time. For real delegation,
use the MCP arrangement above.

## What next

- [Connect an MCP server](/docs/mcp-servers)
- [Who can manage your agent](/docs/access)
