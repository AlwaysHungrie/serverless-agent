import { AppPreview } from "./AppPreview";
import { Globe } from "./Globe";
import { CountUp, HeroSquircles, Reveal } from "./motion";
import { TelegramSignup } from "./TelegramSignup";
import { Button, Eyebrow, Placeholder, Wrap } from "./ui";

/* ---------------------------------------------------------------- Hero -- */

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-36 pb-10 sm:pt-44">
      {/* A single faint wash behind the headline; no gradients elsewhere. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,#f3f3f3_0%,#ffffff_70%)]"
      />

      {/* Squircle slots stand in for the app icons this page will eventually show. */}
      <HeroSquircles />

      <Wrap className="relative text-center">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-[10px] bg-canvas-soft px-3 py-1.5 text-[12px] font-semibold text-muted sm:px-4 sm:py-2 sm:text-[13px]">
            AI agents with their own Telegram accounts
          </span>
        </Reveal>

        <Reveal delay={0.05}>
          <h1 className="mx-auto mt-5 max-w-[15ch] text-[clamp(34px,9vw,84px)] font-[650] leading-[1.02] tracking-[-0.03em] text-balance sm:mt-6 sm:leading-[0.98]">
            Personal AI Agents. Always Online. Forever.
          </h1>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="mx-auto mt-5 max-w-[680px] text-[16px] font-light leading-[1.5] text-muted text-balance sm:mt-6 sm:text-xl sm:leading-[1.4]">
            Create an agent that never sleeps and runs{" "}
            <span className="font-medium">free, forever.</span>{" "}
            <span className="hidden">
              Chat via web or telegram, use built-in capabilities or connect it
              to any external websites or tools you use.
            </span>{" "}
            Manage your day, your inbox, your relationships, your spreadsheets,
            your business.
          </p>
          <p className="mx-auto mt-4 max-w-[620px] text-[16px] font-light leading-[1.5] text-muted text-balance sm:mt-6 sm:text-xl sm:leading-[1.4]">
            Bring your own API key and run any model that works for you.
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button href="#start">Get my agent</Button>
            <Button href="#how" variant="outline">
              See how it works
            </Button>
          </div>
          <p className="mt-4 text-[13px] text-faint sm:text-sm">
            Usage limits apply. Self-hosting needs a Cloudflare account.
          </p>
        </Reveal>

        <Reveal delay={0.2}>
          <AppPreview className="mt-24 sm:mt-32" />
        </Reveal>
      </Wrap>
    </section>
  );
}

/* -------------------------------------------------------------- Mission -- */

export function Mission() {
  return (
    <section id="mission" className="mt-32 scroll-mt-28">
      <Wrap>
        <Reveal>
          <div className="relative overflow-hidden rounded-[32px] bg-ink px-6 py-16 text-center text-white sm:px-12 sm:py-20">
            {/* Cropped by the card edge, so it reads as a world still turning. */}
            <Globe className="pointer-events-none absolute right-0 top-1/2 hidden h-[520px] w-[520px] -translate-y-1/2 translate-x-[45%] lg:block" />
            <div className="relative">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">
                The plan
              </p>
              <p className="mt-6 text-[clamp(44px,9vw,96px)] font-[650] leading-none tracking-[-0.03em]">
                <CountUp to={8.1} decimals={1} suffix="B" />
              </p>
              <h2 className="mx-auto mt-6 max-w-[18ch] text-[clamp(26px,3.5vw,38px)] font-[650] leading-[1.1] tracking-[-0.025em] text-balance">
                People on Earth. One AI agent each.
              </h2>
              <p className="mx-auto mt-4 max-w-[540px] text-lg font-light leading-[1.45] text-faint text-balance">
                Not one giant assistant shared by everyone. One small agent per
                person, that only knows you, and that you can switch off
                whenever you like.
              </p>
              <p className="mt-8 text-sm text-faint">
                <span className="font-semibold text-white">
                  <CountUp to={50241} />
                </span>{" "}
                awake so far.
              </p>
            </div>
          </div>
        </Reveal>
      </Wrap>
    </section>
  );
}

/* --------------------------------------------------------------- Stats -- */

const STATS = [
  {
    value: "1 agent",
    label:
      "Per user. Business accounts can sponsor multiple agents for their customers.",
  },
  {
    value: "256 sessions",
    label:
      "Delete older sessions. Or use a Cloudflare account to bypass all usage limits.",
  },
  {
    value: "$0",
    label:
      "Use your own Openrouter API key, pick any model. Pay only for what you use.",
  },
];

export function Stats() {
  return (
    <Wrap className="mt-24">
      <Reveal>
        <div className="grid gap-px overflow-hidden rounded-[24px] bg-hairline-soft sm:grid-cols-3">
          {STATS.map((s) => (
            <div key={s.value} className="bg-canvas p-8">
              <p className="tnum text-[40px] font-[650] leading-none tracking-[-0.03em]">
                {s.value}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </Reveal>
    </Wrap>
  );
}

/* ------------------------------------------------------------ Features -- */

const FEATURES = [
  {
    title: "It lives in Telegram",
    body: "The same app you use for your family group. Type to it, forward it a link, send a photo of a menu, hold the mic and talk. No new login, no new app on your home screen.",
    wide: true,
  },
  {
    title: "It remembers you",
    body: "Your dog's name, how you take your coffee, the project you're stuck on. Tell it once and it keeps it.",
  },
  {
    title: "It looks things up",
    body: "It searches the web and reads pages you send, so the answer is today's, not last year's.",
  },
  {
    title: "It reminds you",
    body: "Ask it to check in at 8am, every Monday, or before your flight. It messages you first.",
  },
  {
    title: "It reads photos and files",
    body: "A receipt, a lease, a handwritten note, a screenshot. Send it over and ask what it says.",
  },
];

export function Features() {
  return (
    <section id="skills" className="mt-32 scroll-mt-28">
      <Wrap>
        <Reveal>
          <div className="mx-auto max-w-[640px] text-center">
            <Eyebrow>What it does</Eyebrow>
            <h2 className="mt-3 text-[clamp(30px,4.5vw,44px)] font-[650] leading-[1.08] tracking-[-0.025em]">
              Less of a chatbot. More of a someone.
            </h2>
            <p className="mt-4 text-xl font-light leading-[1.4] text-muted text-balance">
              It keeps what you tell it, brings things up when they matter, and
              talks the way you already text.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal
              key={f.title}
              delay={i * 0.05}
              className={f.wide ? "md:col-span-2" : ""}
            >
              <article className="flex h-full flex-col rounded-[24px] bg-canvas p-7 ring-1 ring-hairline-soft transition-colors hover:bg-canvas-soft">
                <h3 className="text-xl font-semibold tracking-[-0.01em]">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {f.body}
                </p>
              </article>
            </Reveal>
          ))}
          <Reveal delay={0.25}>
            <article className="flex h-full flex-col justify-between rounded-[24px] bg-ink p-7 text-white">
              <h3 className="text-xl font-semibold tracking-[-0.01em]">
                It's yours alone
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-faint">
                Your agent has its own memory and its own chat. No one else's
                agent can read it, and deleting it takes everything with it.
              </p>
            </article>
          </Reveal>
        </div>
      </Wrap>
    </section>
  );
}

/* --------------------------------------------------------------- Split -- */

function Split({
  eyebrow,
  title,
  body,
  bullets,
  label,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  label: string;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-12 md:grid-cols-2">
      <Reveal className={reverse ? "md:order-2" : ""}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-3 text-[clamp(26px,3.5vw,34px)] font-[650] leading-[1.1] tracking-[-0.025em]">
          {title}
        </h2>
        <p className="mt-4 leading-relaxed text-muted">{body}</p>
        <ul className="mt-6">
          {bullets.map((b) => (
            <li
              key={b}
              className="border-t border-hairline-soft py-3 text-sm leading-relaxed"
            >
              {b}
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal delay={0.08}>
        <Placeholder frame label={label} />
      </Reveal>
    </div>
  );
}

export function Costs() {
  return (
    <section id="costs" className="mt-32 scroll-mt-28 space-y-24">
      <Wrap>
        <Split
          eyebrow="What it costs"
          title="Pennies, and you see every one."
          body="Most AI apps charge a flat fee and never tell you what you used. Here, each reply shows what it cost to produce. A month of everyday chatting usually adds up to less than a coffee."
          bullets={[
            "The cost of a reply, shown next to the reply",
            "A running total for every conversation",
            "No subscription to forget about",
            "Stop a long answer halfway and stop paying for it",
          ]}
          label="Placeholder — a reply with its cost shown underneath"
        />
      </Wrap>
      <Wrap>
        <Split
          reverse
          eyebrow="Your agent, your business"
          title="Nobody is reading over your shoulder."
          body="Your agent keeps its own memory in its own place. It isn't pooled with anyone else's, it isn't training anything, and it's gone the moment you say so."
          bullets={[
            "Your chats stay in your agent, not in a shared pile",
            "Only you can open it — an invite is the only way in",
            "Delete a conversation and it's wiped, not archived",
            "Delete the agent and the memories go with it",
          ]}
          label="Placeholder — the settings screen for one agent"
        />
      </Wrap>
    </section>
  );
}

/* -------------------------------------------------------- Capabilities -- */

const CAPABILITIES = [
  "Answer questions",
  "Search the web",
  "Read a link you send",
  "Look at photos",
  "Listen to voice notes",
  "Make pictures",
  "Read files and receipts",
  "Remember what matters",
  "Check in on a schedule",
  "Connect to your other apps",
];

export function Capabilities() {
  return (
    <section id="capabilities" className="mt-32 scroll-mt-28">
      <Wrap>
        <Reveal>
          <div className="rounded-[32px] bg-canvas-soft p-8 sm:p-12">
            <div className="max-w-[560px]">
              <Eyebrow>Switches</Eyebrow>
              <h2 className="mt-3 text-[clamp(26px,3.5vw,34px)] font-[650] leading-[1.1] tracking-[-0.025em]">
                Turn on only what you want it doing.
              </h2>
              <p className="mt-4 leading-relaxed text-muted">
                Every one of these starts off. Flip a switch when you need it,
                flip it back when you don't.
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {CAPABILITIES.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-canvas px-4 py-2 text-sm ring-1 ring-hairline-soft"
                >
                  {c}
                </span>
              ))}
              <span className="rounded-full px-4 py-2 text-sm text-faint ring-1 ring-hairline">
                and more as we add them
              </span>
            </div>
          </div>
        </Reveal>
      </Wrap>
    </section>
  );
}

/* --------------------------------------------------------------- Steps -- */

const STEPS = [
  {
    n: "01",
    title: "Make a bot in Telegram",
    body: "Message @BotFather, send /newbot, and copy the token it gives you. A minute, no coding.",
  },
  {
    n: "02",
    title: "Name your agent",
    body: "Paste the token, pick a name, and choose how you'd like it to talk to you.",
  },
  {
    n: "03",
    title: "Say hello",
    body: "Open Telegram and text it. It's there from then on, in the same list as everyone else.",
  },
];

export function Steps() {
  return (
    <section id="how" className="mt-32 scroll-mt-28">
      <Wrap>
        <Reveal>
          <div className="mx-auto max-w-[640px] text-center">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-3 text-[clamp(30px,4.5vw,44px)] font-[650] leading-[1.08] tracking-[-0.025em]">
              Three steps, about a minute.
            </h2>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.06}>
              <div className="border-t border-hairline pt-5">
                <p className="tnum text-sm font-semibold text-faint">{s.n}</p>
                <h3 className="mt-2 text-xl font-semibold tracking-[-0.01em]">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {s.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Wrap>
    </section>
  );
}

/* ----------------------------------------------------------------- CTA -- */

export function Cta() {
  return (
    <section id="start" className="mt-32 scroll-mt-28 pb-32">
      <Wrap>
        <Reveal>
          <div className="rounded-[32px] bg-canvas-soft px-6 py-20 text-center">
            <h2 className="text-[clamp(30px,4.5vw,44px)] font-[650] leading-[1.08] tracking-[-0.025em]">
              Your agent is one message away.
            </h2>
            <p className="mx-auto mt-4 max-w-[520px] text-xl font-light leading-[1.4] text-muted text-balance">
              Grab a token from Telegram, give your agent a name, and it's
              yours. Everything else is a switch you can flip later.
            </p>
            <div className="mt-10">
              <TelegramSignup />
            </div>
          </div>
        </Reveal>
      </Wrap>
    </section>
  );
}
