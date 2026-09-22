---
title: Who can manage your agent
section: Control and access
order: 2
summary: Anyone added to an agent's access list is a co-owner, not a guest, and gets everything you have.
---

An agent carries a list of email addresses under **Settings → Manage access**. Anybody on
it can open the agent in full.

## What "in full" means

Everyone on the list gets the same thing you have:

- every conversation, web and Telegram, and everything in them
- every memory the agent holds
- the settings, the capabilities and the connected tools
- the ability to add and remove people, including you

They are co-owners, not guests. There is no read-only seat and no per-session sharing.
Add somebody only if all of that is what you intend.

A connected tool follows the same rule. If your agent is connected to your Notion,
somebody on the access list can ask it Notion questions and get your answers.

## Adding and removing

Type an address and save. Someone not on the list who finds the agent's page is told the
agent does not exist, rather than that they may not have it.

Two rules:

- **You cannot remove yourself.** Removing yourself would hand the agent over and lock
  you out of the only page that could undo it.
- **The list may not be empty.** An agent nobody owns is an agent nobody can get back
  into.

At creation the list is exactly what was typed. Your own address is filled in for you, so
leaving yourself off has to be a deliberate act, which is occasionally what you want if
you are setting an agent up for someone else.

Up to 200 addresses.

## A note on keys

API keys are held with the agent so it can use them, and are masked in the interface: a
saved key reads back as `••••••••` rather than as itself. But an owner can use the
agent, and the agent uses the key. Treat access as spending access, and keep a limit set
on your OpenRouter account.

## Business accounts

A business account lets you sponsor and co-manage agents for your own customers, two of
them or twenty thousand. See the [business account FAQ](/#faq) on the homepage for what
it covers, or reach out to us to set one up.

## What next

- [Who may talk to your bot](/docs/telegram-gating)
- [Usage limits](/docs/usage-limits)
