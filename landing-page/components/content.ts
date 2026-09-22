/**
 * Single source of truth for everything the landing page says and counts.
 *
 * Rules of thumb:
 *  - No copy lives in a component. If you want to reword the page, edit here.
 *  - Numbers that appear more than once are constants, never literals.
 *  - Section ids are declared in NAV (below) so the header highlight can never
 *    fall out of sync with the page order.
 */

/* --------------------------------------------------------------- Brand -- */

export const BRAND = {
  /** Product name, used in the wordmark and in running copy. */
  name: "Salts",
  /** Legal entity, used in the copyright line only. */
  legalName: "Salt Agents",
  year: 2026,
} as const;

/* ------------------------------------------------------------- Numbers -- */

/** Agents live right now. Used by the header counter and the mission maths. */
export const AGENTS_DEPLOYED = 241;

/** World population the mission counts up to, in billions. */
export const WORLD_POPULATION_B = 8.31;

/** Share of the world with an agent, as a percentage. Derived, never typed. */
export const COVERAGE_PERCENT =
  (AGENTS_DEPLOYED * 100) / (WORLD_POPULATION_B * 1_000_000_000);

/** Chat sessions a free agent keeps before you need to delete older ones. */
export const SESSION_LIMIT = 256;

/* ---------------------------------------------------- Navigation model -- */

/**
 * One nav entry can own several page sections. `sections` lists every section
 * id that should light this link up, in page order — so adding a new section
 * means adding its id to the group it belongs to, not adding a nav link.
 *
 * The page must render these ids in exactly this order for the highlight to
 * travel smoothly; see app/page.tsx.
 */
export const NAV = [
  { id: "skills", label: "What it does", sections: ["stats", "skills", "mission"] },
  { id: "how", label: "How it works", sections: ["how"] },
  { id: "costs", label: "Pricing", sections: ["costs", "capabilities"] },
  { id: "faq", label: "FAQ", sections: ["faq", "start"] },
] as const;

/** Every observed section id, flattened. */
export const NAV_SECTION_IDS = NAV.flatMap((n) => n.sections);

/** Section id -> the nav entry that owns it. */
export const NAV_OWNER: Record<string, string> = Object.fromEntries(
  NAV.flatMap((n) => n.sections.map((s) => [s, n.id])),
);

/* --------------------------------------------------------------- Links -- */

/**
 * Every destination on the page. Entries set to `null` are not built yet and
 * render as disabled text instead of a dead `#` link — see BROKEN-LINKS.md.
 */
export const LINKS = {
  signIn: null as string | null,
  signUp: null as string | null,
  contact: null as string | null,
  privacy: null as string | null,
  terms: null as string | null,
  botFather: "https://t.me/BotFather",
  openRouter: "https://openrouter.ai/settings/keys",
} as const;

/* ----------------------------------------------------------------- Copy -- */

export const HERO = {
  eyebrow: "AI agents with their own Telegram accounts",
  title: "Personal AI agents. Always online. Forever.",
  body: [
    "Create an agent that never sleeps and runs",
    "free, forever.",
    "Manage your day, your inbox, your relationships, your spreadsheets, your business.",
  ],
  bodySecondary: "Bring your own API key and run any model that works for you.",
  primaryCta: "Get my agent",
  secondaryCta: "See how it works",
  footnote: "Usage limits apply. Self-hosting needs a Cloudflare account.",
} as const;

export const STATS = [
  {
    value: "1 agent",
    label:
      "Per person. Business accounts can sponsor agents for their customers.",
  },
  {
    value: `${SESSION_LIMIT} sessions`,
    label:
      "Delete older sessions to make room, or self-host on Cloudflare to bypass usage limits.",
  },
  {
    value: "$0",
    label:
      "Use your own OpenRouter API key and pick any model. You pay only for what you use.",
  },
] as const;

export const FEATURES = {
  eyebrow: "What it can do for you",
  title: "One agent, a billion possibilities",
  body: `${BRAND.name} has a rich set of built-in capabilities and an ever-expanding set of external tools and websites it can connect to. Reach out if there's a use case we haven't covered yet.`,
  cards: [
    {
      title: "It has a Telegram account",
      body: "The same app you already use. Type a message, forward a link, send photos, or hold the mic and talk. You decide which people, groups, and topics it answers in.",
      wide: true,
    },
    {
      title: "It remembers",
      body: "Your dog's name, your coffee order, what it's supposed to follow up on next week. You only have to tell it once.",
    },
    {
      title: "It looks things up",
      body: "It searches the web, reads the pages you send, and digs through Notion, Gmail, and anything else you connect it to.",
    },
    {
      title: "It reminds you",
      body: "Ask it to check in at 8am, every Monday, or before your flight. It messages you first.",
    },
    {
      title: "It reads photos and files",
      body: "A receipt, a lease, a handwritten note, a screenshot. Send it over and ask what it says.",
    },
  ],
  /** The one dark card at the end of the grid. */
  highlight: {
    title: "You are in control",
    body: "You own your agent's chats and memories, and you choose which of them to share with people you trust.",
  },
} as const;

export const MISSION = {
  eyebrow: "Not stopping until",
  titleSuffix: "agents.",
  subtitle: "One for each person.",
  body: "Humanity lacks coordination, not resources. We're here to make sure every person on the planet has open and equal access to AI.",
  coverageSuffix: "covered so far.",
} as const;

export const PRICING = {
  eyebrow: "Pricing",
  title: "$0 to run, plus model costs.",
  body: `${BRAND.name} is fully capable without any hardware of its own. You stay in control of what you spend — set a billing limit on your OpenRouter account and that's your ceiling.`,
  bullets: [
    `Run up to ${SESSION_LIMIT} active chat sessions, and delete the ones you no longer need`,
    "Connect as many tools and external websites as you want",
    "Self-host on your own Cloudflare account to pay for your own resources and bypass every usage limit",
  ],
  placeholder: "Placeholder — a reply with its cost shown underneath",
} as const;

export const OWNERSHIP = {
  eyebrow: "Own your agent",
  title: "Customise your agent and control its access.",
  body: "You own your agent's memories and chat history. Decide what it can and cannot do, and who is allowed to change those settings.",
  bullets: [
    "Invite other people to help manage your agent, and set what they're allowed to change",
    "Get fine-grained control over who can message your agent on Telegram",
    "Open a business account to sponsor agents for your customers and co-manage them together",
    "Reach out to us to open a business account today",
  ],
  placeholder: "Placeholder — the settings screen for one agent",
} as const;

export const CAPABILITIES = {
  eyebrow: "Capabilities",
  title: "Turn on what you need, whenever you need it.",
  body: "Capabilities and external tools are as easy as flipping a switch. Switch them back off when you're done.",
  items: [
    "Search the web",
    "Read a link you send",
    "Look at photos",
    "Listen to voice notes",
    "Make pictures",
    "Read PDF files",
    "Remember what matters",
    "Check your Google Calendar",
    "Connect to your Notion",
  ],
  more: "New switches added every day.",
} as const;

/**
 * The three-step setup. Rendered twice — once in "How it works" and once in
 * the closing call to action — from this one list.
 */
export const STEPS = [
  {
    n: "01",
    title: "Get an OpenRouter API key",
    body: "Create an OpenRouter account, set a spending limit, choose which models are allowed, and copy your key.",
  },
  {
    n: "02",
    optional: true,
    title: "Get a Telegram bot token",
    body: "Message @BotFather on Telegram, send /newbot, and follow the prompts. It replies with a bot token.",
  },
  {
    n: "03",
    title: "That's it",
    body: "Sign up, add your keys, and start using your agent. There's plenty more to explore once you're going.",
  },
] as const;

export const HOW = {
  eyebrow: "How it works",
  title: "Get your API key, then sign up.",
} as const;

export const FAQ = {
  eyebrow: "FAQ",
  title: "Something on your mind.",
  items: [
    {
      q: "What do I need before I start?",
      a: "An OpenRouter API key. That's the only requirement — create an account, set a spending limit, and copy the key. A Telegram bot token is optional and takes about a minute if you want your agent to live in Telegram.",
    },
    {
      q: `Is it really free, or is "$0" a trick?`,
      a: `Running ${BRAND.name} costs you nothing. The only thing you pay for is the model, billed by OpenRouter at their rates, on the key you supply. There is no subscription and no card on file with us.`,
    },
    {
      q: "Do I have to use Telegram?",
      a: "No. Telegram is the reason most people want an agent that's always reachable, but it's step two and it's optional. Your agent works without it.",
    },
    {
      q: `What happens when I hit ${SESSION_LIMIT} sessions?`,
      a: `A free agent keeps up to ${SESSION_LIMIT} active chat sessions. Delete the ones you're finished with to make room, or self-host on your own Cloudflare account to remove the limit entirely.`,
    },
    {
      q: "What does self-hosting actually change?",
      a: "You run the agent on your own Cloudflare account, so you pay Cloudflare for the resources it uses and every usage limit on this page goes away. Everything else works the same.",
    },
    {
      q: "Who can see my agent's chats and memories?",
      a: "You, and only the people you invite. Your agent's memory and chats are yours — you can share them, restrict who is allowed to message it on Telegram, and delete any of it at any time.",
    },
    {
      q: "Can I have more than one agent?",
      a: "One agent per person on a normal account. Business accounts are the exception: they can sponsor agents for their customers and co-manage those agents alongside them. Reach out if that's you.",
    },
    {
      q: "What's the one-agent-per-person thing about?",
      a: `We think everyone should have an AI that is genuinely theirs. That's the whole plan — ${WORLD_POPULATION_B} billion agents, one for each person, starting with yours.`,
    },
  ],
} as const;

export const CTA = {
  title: "Your agent is already online.",
  body: "Start using it by giving it an API key. Everything else can wait.",
} as const;

/**
 * The signup card in the closing call to action. Its three steps mirror STEPS
 * above: key, token, done. It never asks for a name — the agent takes that
 * from the bot behind the token.
 */
export const SIGNUP = {
  steps: ["API key", "Telegram bot", "Create"],
  key: {
    label: "Paste your OpenRouter API key",
    help: "Create a key on OpenRouter, set a spending limit, and paste it here. You pay OpenRouter directly for whatever your agent uses.",
    linkLabel: "OpenRouter",
    placeholder: "sk-or-v1-…",
    cta: "Continue",
    empty: "Paste the key from your OpenRouter account.",
    invalid: "That doesn't look like an OpenRouter key. They start with sk-or-v1-.",
  },
  token: {
    label: "Paste your Telegram bot token",
    help: "Message @BotFather on Telegram, send /newbot, and copy the token it replies with. Your agent takes its name from that bot, so there's nothing else to fill in.",
    linkLabel: "@BotFather on Telegram",
    placeholder: "8412345678:AAH…",
    cta: "Continue",
    skip: "Skip for now",
    invalid: "That doesn't look like a token. Copy the whole line, numbers and all.",
  },
  done: {
    withBot: "Your agent is ready to wake up.",
    withoutBot: "Your agent is ready without Telegram.",
    bodyWithBot:
      "Create your account and your agent starts answering in Telegram under your bot's name. You can delete it in one tap.",
    bodyWithoutBot:
      "Create your account and your agent is live. Add a Telegram bot whenever you want it reachable there.",
    cta: "Create my agent",
    restart: "Start over",
  },
  footnote: "No credit card. Your keys stay yours — delete the agent and they're gone.",
} as const;

export const FOOTER = {
  tagline: `An agent that's yours alone — always online, running on your key, on the model you choose. ${BRAND.name} keeps the chats and memories with you, not with us.`,
  note: "Free forever. Self-host for higher usage limits.",
  columns: [
    {
      title: "Product",
      links: [
        { href: "#skills", label: "What it does" },
        { href: "#how", label: "How it works" },
        { href: "#costs", label: "Pricing" },
      ],
    },
    {
      title: "Resources",
      links: [
        { href: "#mission", label: "The plan" },
        { href: LINKS.botFather, label: "Get a Telegram token" },
        { href: "#faq", label: "FAQ" },
      ],
    },
    {
      title: "Company",
      links: [
        { href: LINKS.contact, label: "Contact" },
        { href: LINKS.privacy, label: "Privacy" },
        { href: LINKS.terms, label: "Terms" },
      ],
    },
  ],
} as const;
