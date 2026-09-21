import { Reveal } from "./motion";
import { Button, Eyebrow, Placeholder, Wrap } from "./ui";

/* ---------------------------------------------------------------- Hero -- */

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-36 sm:pt-44">
      {/* A single faint wash behind the headline; no gradients elsewhere. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,#f3f3f3_0%,#ffffff_70%)]"
      />

      {/* Squircle slots stand in for the app icons this page will eventually show. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
        <div className="squircle absolute left-[6%] top-[22%] size-16 bg-canvas-soft ring-1 ring-hairline-soft" />
        <div className="squircle absolute left-[13%] top-[52%] size-12 bg-canvas-soft ring-1 ring-hairline-soft" />
        <div className="squircle absolute right-[7%] top-[28%] size-20 bg-canvas-soft ring-1 ring-hairline-soft" />
        <div className="squircle absolute right-[15%] top-[58%] size-12 bg-canvas-soft ring-1 ring-hairline-soft" />
      </div>

      <Wrap className="relative text-center">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full bg-canvas-soft px-4 py-2 text-[13px] font-semibold text-muted">
            <span className="size-1.5 rounded-full bg-accent" />
            One object per agent. One per session.
          </span>
        </Reveal>

        <Reveal delay={0.05}>
          <h1 className="mx-auto mt-6 max-w-[14ch] text-[clamp(44px,8vw,84px)] font-[650] leading-[0.98] tracking-[-0.03em] text-balance">
            Run agents that share nothing.
          </h1>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="mx-auto mt-6 max-w-[620px] text-xl font-light leading-[1.4] text-muted text-balance">
            Every agent gets its own keys, memory and sessions. You see what each
            message costs while it streams.
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button href="#">Create an agent</Button>
            <Button href="#how" variant="outline">
              See how it works
            </Button>
          </div>
          <p className="mt-4 text-sm text-faint">
            Bring your own OpenRouter key. No shared deployment key, ever.
          </p>
        </Reveal>

        <Reveal delay={0.2}>
          <Placeholder
            frame
            label="Placeholder — chat view with per-message tokens, cost and latency"
            className="mt-14 text-left"
          />
        </Reveal>
      </Wrap>
    </section>
  );
}

/* --------------------------------------------------------------- Stats -- */

const STATS = [
  { value: "1:1", label: "One Durable Object per session, one per agent. Nothing is pooled." },
  { value: "$0.00005", label: "Roughly what a message costs to run. About 78% of it is tokens." },
  { value: "0", label: "Shared secrets between agents. Delete one, its data goes too." },
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
              <p className="mt-3 text-sm leading-relaxed text-muted">{s.label}</p>
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
    title: "Isolated by default",
    body: "Each agent holds its own OpenRouter key, Telegram bot, MCP servers and memories. Two agents can't read each other.",
    wide: true,
  },
  {
    title: "Sessions with real storage",
    body: "Every session is a Durable Object with its own SQLite database. Create one, it registers. Delete one, its storage is wiped.",
  },
  {
    title: "Costs as they happen",
    body: "Tokens in, tokens out, dollars and model latency — on each assistant message, not in a monthly invoice.",
  },
  {
    title: "Access you control",
    body: "Sign-in is Clerk. Each agent carries its own list of addresses, and an address not on it is told the agent doesn't exist.",
  },
  {
    title: "Capabilities you switch on",
    body: "Web search, file ingest, images, audio, scheduled tasks and memory. Each is off until you turn it on.",
  },
];

export function Features() {
  return (
    <section className="mt-32">
      <Wrap>
        <Reveal>
          <div className="mx-auto max-w-[640px] text-center">
            <Eyebrow>What you get</Eyebrow>
            <h2 className="mt-3 text-[clamp(30px,4.5vw,44px)] font-[650] leading-[1.08] tracking-[-0.025em]">
              An agent you can account for.
            </h2>
            <p className="mt-4 text-xl font-light leading-[1.4] text-muted text-balance">
              Most agent platforms hide the machine. This one shows you the object,
              the tokens and the bill.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.05} className={f.wide ? "md:col-span-2" : ""}>
              <article className="flex h-full flex-col rounded-[24px] bg-canvas p-7 ring-1 ring-hairline-soft transition-colors hover:bg-canvas-soft">
                <h3 className="text-xl font-semibold tracking-[-0.01em]">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
              </article>
            </Reveal>
          ))}
          <Reveal delay={0.25}>
            <article className="flex h-full flex-col justify-between rounded-[24px] bg-ink p-7 text-white">
              <h3 className="text-xl font-semibold tracking-[-0.01em]">
                Any model on OpenRouter
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-faint">
                Set the model, instructions, reasoning effort, temperature and context
                window per agent. Change them without a deploy.
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
          eyebrow="Costs"
          title="Read the meter, not the estimate."
          body="OpenRouter reports the exact price of every call, so that's the number you see. Cloudflare's own costs aren't guessed at — they can't be measured honestly from inside the object, so we document them instead."
          bullets={[
            "Tokens in and out on every assistant message",
            "Dollar cost and model latency per reply",
            "Session totals in the header: model, messages, tokens, spend",
            "Stop a stream and keep the partial reply — and the tokens already billed",
          ]}
          label="Placeholder — cost breakdown panel"
        />
      </Wrap>
      <Wrap>
        <Split
          reverse
          eyebrow="Architecture"
          title="One object per session."
          body="An agent is a Durable Object. So is each of its sessions. State lives next to the code that reads it, the object sleeps when nobody is talking, and scaling out means more objects, not a bigger box."
          bullets={[
            "Cloudflare Workers and Durable Objects underneath",
            "SQLite storage per session, not a shared table",
            "A Next.js app that streams the reply as it arrives",
            "No browser-to-worker calls — every request goes through a route handler",
          ]}
          label="Placeholder — architecture diagram"
        />
      </Wrap>
    </section>
  );
}

/* -------------------------------------------------------- Capabilities -- */

const CAPABILITIES = [
  "Web search",
  "Read a URL",
  "File ingest",
  "Image input",
  "Image generation",
  "Audio input",
  "Scheduled tasks",
  "Memory",
  "MCP servers",
  "Telegram bot",
];

export function Capabilities() {
  return (
    <section id="capabilities" className="mt-32 scroll-mt-28">
      <Wrap>
        <Reveal>
          <div className="rounded-[32px] bg-canvas-soft p-8 sm:p-12">
            <div className="max-w-[560px]">
              <Eyebrow>Capabilities</Eyebrow>
              <h2 className="mt-3 text-[clamp(26px,3.5vw,34px)] font-[650] leading-[1.1] tracking-[-0.025em]">
                Turn on only what the agent needs.
              </h2>
              <p className="mt-4 leading-relaxed text-muted">
                Every capability starts off. The ones that need a key say so before you
                enable them.
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
                and the settings behind each one
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
    title: "Name it and key it",
    body: "Give the agent a name and an OpenRouter key. It can answer the moment it opens.",
  },
  {
    n: "02",
    title: "Set how it talks",
    body: "Pick the model, write the instructions, set the reply cap and context window.",
  },
  {
    n: "03",
    title: "Open a session",
    body: "Start chatting. Each session gets its own object, and the cost shows as the reply streams.",
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
              Three steps to a working agent.
            </h2>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.06}>
              <div className="border-t border-hairline pt-5">
                <p className="tnum text-sm font-semibold text-faint">{s.n}</p>
                <h3 className="mt-2 text-xl font-semibold tracking-[-0.01em]">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
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
    <section className="mt-32 pb-32">
      <Wrap>
        <Reveal>
          <div className="rounded-[32px] bg-canvas-soft px-6 py-20 text-center">
            <h2 className="text-[clamp(30px,4.5vw,44px)] font-[650] leading-[1.08] tracking-[-0.025em]">
              Start with one agent.
            </h2>
            <p className="mx-auto mt-4 max-w-[520px] text-xl font-light leading-[1.4] text-muted text-balance">
              A name and a key is the whole setup. Everything else is a switch you can
              flip later.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button href="#">Create an agent</Button>
              <Button href="#" variant="outline">
                Read the docs
              </Button>
            </div>
          </div>
        </Reveal>
      </Wrap>
    </section>
  );
}
