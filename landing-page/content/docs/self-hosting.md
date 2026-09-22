---
title: Host it yourself
section: Run it yourself
order: 1
summary: Run the whole thing on your own Cloudflare account, with no usage limits and your own keys and data, and what that actually involves.
---

Salts runs on Cloudflare: a Worker, some Durable Objects and a storage bucket. There is
no server to maintain and nothing to keep running. If you have a Cloudflare account you
can host the whole product yourself.

## Why you would

- **No limits.** Sessions, agents and storage are whatever your account will hold.
- **Your data stays in your account.** Conversations, memories and keys live in your
  Cloudflare, not ours.
- **You can change it.** The models offered, the capabilities, and the prompts are all
  your deployment to change.

The cost is low: Cloudflare charges for requests and for the seconds an agent spends
awake, both billed at usage-based rates. A billing plan on Cloudflare is required; the
model spend is still yours on OpenRouter.

## What you need

- A Cloudflare account with a billing plan, and `wrangler` installed.
- A [Clerk](https://clerk.com) account, which handles sign-in.
- Node, and about half an hour the first time.

## The shape of it

Two deployables:

- **`agent/`**: the Cloudflare Worker. It is the agent: sessions, tools, Telegram,
  MCP, memory.
- **`frontend/`**: the Next.js app you look at. It never talks to the Worker from the
  browser; every call goes through its own server, so no key is ever exposed.

## Deploying the agent

```bash
cd agent
npm install                 # npm, not pnpm: the lockfile here is package-lock.json
wrangler r2 bucket create salt-agent-files
npm run deploy
```

Two things must be set before that deploy will go through.

**`CLERK_ISSUER`** in `wrangler.jsonc`: the exact issuer your Clerk tokens carry, like
`https://your-app.clerk.accounts.dev`. It is a public URL, not a secret. Without it the
Worker refuses to serve at all, which is deliberate: an unconfigured deployment cannot
verify anybody, and refusing to start is better than running with no gate.

**An `email` claim in the Clerk session token.** In the Clerk dashboard, under
Sessions → Customize session token, add:

```json
{ "email": "{{user.primary_email_address}}" }
```

Access lists are email addresses, so a token without that claim identifies nobody and
every request is refused.

## Deploying the frontend

```bash
cd frontend
pnpm install                # pnpm here
pnpm dev                    # or deploy it wherever you host Next.js
```

`frontend/.env.local` needs `AGENT_URL` pointing at your Worker, plus your Clerk keys.
There is no shared secret between the two: the Worker identifies a caller from the
Clerk token the frontend forwards.

## Running it locally first

```bash
cd agent && npm run dev          # http://localhost:8787
cd frontend && pnpm dev          # http://localhost:3000
```

`wrangler dev` simulates the storage bucket, so local development needs nothing extra.
Telegram is the one part that cannot be local: Telegram has to be able to reach your
webhook, so point a tunnel at the Worker or test that part against a deployment.

## Keys, in your deployment

There is no deployment-wide model key. **Every agent carries its own OpenRouter key**,
and an agent without one cannot answer. That is on purpose: a shared fallback would mean
every agent anyone creates on your deployment spends your credit.

Keys are stored with the agent in its Durable Object and masked in the interface. If your
deployment is going to hold other people's keys, move them to Cloudflare secrets or an
encrypted store first.

## The back door

The Worker supports an optional `API_SECRET`. A caller holding it can act as **any**
email address, with no sign-in. It exists so an operator can act as a user for support.

Leave it unset unless you need it. That is the safe direction to fail in. If you do set
it, treat it as a master key to every account on the deployment. The deploy script tells
you out loud whether one is set.

## What next

- [Usage limits](/docs/usage-limits): what you are escaping.
- [When something breaks](/docs/troubleshooting)
