---
title: Memory
section: Capabilities
order: 3
summary: How the agent keeps facts about you between conversations, how to put things in, and how to keep it from filling up with rubbish.
---

Memory is what separates an agent from a chat window. With it on, a fact worth keeping,
such as "I use pnpm," "my daughter's name is Ada," or "invoices go to accounts@…," is
stored once and available in every conversation afterwards.

Switch it on under **Capabilities → Private memory**. It needs no key.

## What memory is

Memories belong to the **agent**, not to a session. That is the whole point: something
you told it on Telegram last week is known in a fresh web chat today.

They are private to that agent. A second agent of yours knows none of it, and no other
user's agent ever sees any of it.

## Putting something in

Two ways.

**Tell it to remember.** "Remember that I'm vegetarian." The agent stores the fact and
says so.

**Let it notice.** With memory on, the agent stores facts it judges worth keeping as
conversations go along. It errs towards keeping things that are stable and about you,
such as preferences, names, and recurring details, rather than the contents of a
passing conversation.

## Getting something back

You do not have to ask. Recent memories are given to the agent with every message, so it
simply knows. For anything older, it can search its memory when a question calls for it:
"what did I say my flight number was?"

## Keeping it useful

Memory rewards a little tending.

- **Correct it out loud.** "I no longer use pnpm, I use bun. Remember that instead."
- **Be specific when it matters.** "Remember my sister's birthday is 3 March" beats
  "remember my sister's birthday is soon".
- **Keep it to facts, not documents.** Memory is for facts that change how the agent
  talks to you. Documents belong in an attachment or in a connected tool like Notion.

## Memory and new sessions

Starting a new session loses the transcript, not the memories. That is exactly why
starting new sessions is cheap: the parts worth keeping have already been kept.

## Privacy

Memories are stored with your agent and readable by anyone on its access list, which is
a list of owners, not of guests. Before adding someone under
**Settings → Manage access**, remember that they can read everything the agent knows.
See [Who can manage your agent](/docs/access).

## What next

- [Sessions, and when to start a new one](/docs/sessions)
- [Scheduled tasks](/docs/scheduled-tasks)
