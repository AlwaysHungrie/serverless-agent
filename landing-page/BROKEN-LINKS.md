# Broken and unbuilt links

Audit of every destination on the landing page, as of this refactor.

All of these used to render as `href="#"`, which looks like a working link and
scrolls nowhere. They are now typed as `null` in `LINKS` in
`components/content.ts` and rendered through `<MaybeLink>`, which falls back to
plain text. **To fix one, set its value in `LINKS` — nothing else changes.**

| Key | Where it appears | Was | Status |
| --- | --- | --- | --- |
| `signIn` | Header nav (desktop) and mobile menu | `href="#"` | Unbuilt — no sign-in page exists yet |
| `signUp` | Signup card, step 3 `Create my agent` | `href="#"` | Unbuilt — renders as a button that goes nowhere until set. Hero/header `Get my agent` still scrolls to `#start` |
| `contact` | Footer → Company | `href="#"` | Unbuilt |
| `privacy` | Footer → Company | `href="#"` | Unbuilt |
| `terms` | Footer → Company | `href="#"` | Unbuilt |

## Links that do work

| Target | Where | Note |
| --- | --- | --- |
| `https://t.me/BotFather` | Footer → Resources, signup card step 2 | External, opens in a new tab |
| `https://openrouter.ai/settings/keys` | Signup card, step 1 | External, opens in a new tab |
| `#skills` `#how` `#costs` `#faq` `#mission` `#start` `#top` | Header, hero, footer | All resolve to a section that exists |

## Also renamed

- `components/TelegramSignup.tsx` → `components/SignupCard.tsx`. It is no
  longer a Telegram-first flow: step 1 is the OpenRouter key, step 2 is the
  (optional) bot token, step 3 creates the agent. It no longer asks for a name
  — the agent inherits the name of the bot behind the token.
