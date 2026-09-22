---
title: Capabilities
section: Capabilities
order: 1
summary: Everything your agent can do beyond writing text, what each one needs, and why you should not turn them all on.
---

A fresh agent can read and write. Everything else is a capability, switched on under
**Capabilities**. Each is off by default, and the page tells you when one needs a key or
a model of its own before it will work.

## The list

| Capability | What it adds | Needs |
|---|---|---|
| Web search | Answers from the live web, with links | A Brave Search key, or your own SearXNG |
| Read a URL | Opens a link you send and reads the page | Nothing |
| File ingest | Questions about files you attach | Nothing |
| Image input | Questions about photos and screenshots | A model that can see |
| Image generation | Draws pictures on request | An image model, billed to your key |
| Audio input | Listens to voice notes and audio files | A transcription model |
| Schedule tasks | Runs a prompt later, once or repeatedly | Nothing |
| Private memory | Keeps facts about you between conversations | Nothing |
| Telegram | A Telegram account of its own | A bot token |
| MCP servers | Tools from other products and services | A server to connect |

## Two kinds

**Tools**: web search, reading a URL, drawing, scheduling, memory, and everything
reached over MCP. These hand the model functions it may choose to call. It decides when
to use them; you decide whether it may.

**Inputs**: file ingest, image input, audio input. These change what a message may
carry. Nothing is called; the attachment simply becomes something the model can read.

Within one turn the agent may use up to **six rounds of tools** before it has to answer.
That is enough to search, read two of the results and reply. It is also low enough that
a confused agent cannot loop all afternoon on your credit.

## Why not turn everything on

Every tool that is switched on is described to the model on every single message,
whether or not it gets used. A dozen connected MCP servers with thirty tools between
them is a meaningful tax on every reply you ever send.

Switch on what you use. Switch off what you have stopped using. It takes one click, and
nothing is lost: the settings stay where you left them.

## Capabilities to try first

- **Read a URL** costs nothing and needs nothing. Send a link and ask about it.
- **Private memory** stores facts about you across conversations, so you do not repeat
  yourself in every new session.
- **Schedule tasks** lets the agent message you first, on a schedule you set, instead of
  only replying when you write to it.

## What next

- [Web search](/docs/web-search)
- [Memory](/docs/memory)
- [Scheduled tasks](/docs/scheduled-tasks)
- [Files, photos and voice notes](/docs/files-and-media)
