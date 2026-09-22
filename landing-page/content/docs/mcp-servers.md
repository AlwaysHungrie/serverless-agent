---
title: Connect an MCP server
section: Connect other tools
order: 1
summary: MCP is how your agent reaches Notion, your company's systems and anything else with an API. Add a server, authorise it, choose which of its tools your agent may call.
---

Capabilities are the tools we built. MCP is how you add everyone else's.

MCP, the Model Context Protocol, is an open standard for handing tools to an AI agent.
A service publishes an MCP server; your agent connects to it and can then call its tools
as naturally as it searches the web. Notion, Linear, Sentry, Stripe and hundreds of
others publish one, and so can your own team.

Servers live under **Capabilities → MCP servers**.

## Connect one from the list

The strip of logos on that page is servers we already know the details of. Click one,
Notion for example, and the name, address and sign-in method are filled in for you.
Press **Connect**, approve it in the window that opens at the provider, and you are done.

## Connect one by hand

For anything else you need its address and how it authenticates.

1. Press **Add server**.
2. **Name** it. The name is also the prefix its tools appear under, so keep it short and
   recognisable: `notion`, `acme`, `crm`.
3. Paste the **URL**. It usually ends in `/mcp` or `/sse`.
4. Choose how it authenticates:

| Mode | When to use it | What you provide |
|---|---|---|
| None | Open, read-only servers | Nothing |
| API key | Most self-hosted and API-key services | One or more headers, e.g. `Authorization: Bearer …` |
| OAuth | Consumer products like Notion | Nothing — you approve it at the provider |

5. Save. The agent connects and lists the tools the server offers.

With **OAuth**, saving is followed by **Connect**, which sends you to the provider to
sign in. Nothing is typed into Salts: the approval happens on their site and your
account credentials never pass through here.

Only remote servers work: ones reachable over the internet at an address. A server that
runs as a local process on your own machine has nothing to connect to; put it behind a
tunnel or use a hosted version. See [Connect another agent](/docs/external-agents).

## Choosing which tools it may call

Each connected server lists its tools with a switch beside each one. Switch off anything
you do not want your agent reaching for.

Two reasons to bother:

- **Safety.** A server that can both read and delete is safer with the deleting switched
  off.
- **Cost and accuracy.** Every enabled tool is described to the model on every message.
  Thirty tools you never use make every reply slightly more expensive and slightly less
  focused.

A tool the provider adds later arrives switched **on**, because a list you never edited
should keep working as the provider intends. If you are running a tight allowlist, check
back after a provider update.

## Keeping a server working

- **Refresh** re-reads the tool list after the provider changes something.
- A server that failed shows the reason on its card. The common ones are an expired
  OAuth approval (press Connect again) and a rotated API key.
- The switch at the top of a card turns the whole server off without deleting it. Its
  settings and approvals are kept for when you turn it back on.

## What a connected server means

Your agent can call those tools with your permissions. A Notion connection means it can
read the pages your Notion account can read. Anyone on your agent's access list is
therefore also, in effect, reaching those tools. See
[Who can manage your agent](/docs/access) before you add people.

## What next

- [Connect another agent](/docs/external-agents)
- [Capabilities](/docs/capabilities)
