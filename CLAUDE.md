# Project Rules

- No tests unless explicitly required.
- No unrequested thinking/analysis. Answer what is asked.
- No extra features or content beyond the ask.
- Do not use Playwright.

# Admin: business account limits

- Owner (dhairyashah98@gmail.com) can set any account's agent limit directly, no separate approval needed.
- Route: `POST /api/admin/business-account { email, agent_limit }` on the deployed Worker.
- Auth: header `x-api-secret: <API_SECRET>`. Read value from `agent/.dev.vars` (local) or `wrangler secret list`/prod store — never print it or write it into a committed file.
- Deployed base URL: `https://salt-agent.dhairyashah98.workers.dev`.

# Layout

- `agent/` — agent code
- `frontend/` — Next.js app (pnpm)
