---
title: Web search
section: Capabilities
order: 2
summary: Give your agent the live web, with a Brave Search key or a SearXNG instance you run yourself.
---

Without this, your agent answers from what the model learned before it was trained. With
it, it can look things up and show you where the answer came from: prices, news,
opening hours, whether that library still exists.

Switch it on under **Capabilities → Web search**. It needs one of two providers.

## Option 1: Brave Search (easiest)

Brave sells access to their own search index, and has a free tier that covers ordinary
personal use.

1. Go to [brave.com/search/api](https://brave.com/search/api/) and create an account.
2. Subscribe to the free plan. It asks for a card for verification.
3. Copy the API key, which starts with `BSA`.
4. Paste it into the **Brave Search API key** field and save.

That is the whole setup. Searches are billed by Brave, separately from your model spend,
and the free tier's monthly allowance is generous for one person.

## Option 2: SearXNG (free, more work)

SearXNG is an open-source metasearch engine you run yourself. It costs nothing and asks
nobody for a card, but the agent has to be able to reach it over the internet, so a
copy on your laptop needs a tunnel.

1. Run SearXNG. The project's Docker image is the short path.
2. Enable the JSON output it needs, by adding `json` to `formats` in `settings.yml`.
3. Expose it at a public address. A Cloudflare tunnel gives you one in a line:
   `cloudflared tunnel --url http://localhost:8080`.
4. Put that address in the **SearXNG URL** field, for example
   `https://my-searxng.trycloudflare.com`.
5. If your instance requires a token, paste it into **SearXNG token**.

Leave the Brave field empty when using SearXNG. **When a Brave key is present it is used
and SearXNG is ignored**, so the fallback is the thing that runs when there is no key.

## How the agent uses it

The model decides when a question needs the web. You do not have to say "search for,"
though saying it helps when you know the answer has changed recently. Results come back
as titles, links and snippets, and the agent reads what it needs.

If it should have searched and did not, tell it so in
**Settings → Custom instructions**: "Search the web for anything involving current
prices, dates or news."

## Reading the pages it finds

Search returns snippets. To have the agent open a result and read it properly, switch on
**Read a URL** as well. That capability needs no key and no configuration, and it is
also what makes "read this and summarise it" work on a link you paste.

## What next

- [Capabilities](/docs/capabilities)
- [What it costs](/docs/costs)
