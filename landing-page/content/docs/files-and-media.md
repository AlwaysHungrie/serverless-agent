---
title: Files, photos and voice notes
section: Capabilities
order: 5
summary: What your agent can read and hear, what it can draw, and the size limits for each.
---

Three input capabilities and one output capability cover everything that is not plain
text. They are independent, so switch on the ones you need.

## Files

**Capabilities → File ingest.** Attach a document and ask about it. Needs no key.

Text-shaped files (Markdown, CSV, TSV, JSON, YAML, HTML, SQL, logs, and source code in
the usual languages) are read directly, up to **1 MB**. PDFs are read up to **8 MB**,
including scanned ones, which are put through OCR first.

A message can carry **four files**. Send the rest with the next message.

## Photos and screenshots

**Capabilities → Image input**, plus a model that can see. Up to **10 MB** per image,
though large photos are shrunk in your browser before they are sent, so you rarely meet
that limit.

This capability covers more than photos of documents. A photograph of a receipt, a
handwritten note, a whiteboard, an error message on somebody else's screen, or a chart
with no underlying data all become something you can ask questions about.

If images fail, check the model. Under **Settings → Model** the list marks which models
can be sent an image; the cheap default cannot.

## Voice notes and audio

**Capabilities → Audio input.** Up to **25 MB** per clip, and recordings made in the web
app stop at ten minutes.

The clip is transcribed once, when it arrives, using the transcription model you choose
in that capability's settings. The agent then works from the text. A voice note costs
roughly what typing the same words would cost, and the transcript stays in the
conversation so you can read back what you said.

Pick a cheap transcription model unless you have a reason not to; the list is ordered
with the cheapest first.

## Generating images

**Capabilities → Image generation**, plus an image model chosen in the same place. Ask in
words, for example "draw a sketch of a lighthouse at dusk," and the picture comes back
in the conversation, or as a photo in Telegram.

Image models are billed by OpenRouter on your key like any other model, but they cost
considerably more per call than text. The list is ordered cheapest first; the cheapest is
fine for most things.

## The limits, together

| Kind | Ceiling |
|---|---|
| Text, CSV, JSON, code | 1 MB |
| PDF | 8 MB |
| Image | 10 MB |
| Audio | 25 MB |
| Files per message | 4 |

Attachments count towards your account's storage. See
[Usage limits](/docs/usage-limits).

## What next

- [Capabilities](/docs/capabilities)
- [Usage limits](/docs/usage-limits)
