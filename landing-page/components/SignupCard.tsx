"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

import { LINKS, SIGNUP } from "./content";

/**
 * The signup card in the closing call to action. Three steps — key, bot, done —
 * matching the "How it works" list, so the page explains a flow and then runs
 * exactly that flow.
 *
 * It never asks for a name: the agent inherits the name of the bot behind the
 * token. Nothing is sent anywhere yet; the last step hands off to sign-up.
 */

/** OpenRouter keys are `sk-or-v1-` followed by a long opaque tail. */
const KEY = /^sk-or-v1-[A-Za-z0-9_-]{20,}$/;

/** BotFather hands out tokens shaped `<digits>:<35 or so characters>`. */
const TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

export function SignupCard() {
  const [step, setStep] = useState(0);
  const [key, setKey] = useState("");
  const [token, setToken] = useState("");
  const [hasBot, setHasBot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submitKey(e: React.FormEvent) {
    e.preventDefault();
    const value = key.trim();
    if (!value) {
      setError(SIGNUP.key.empty);
      return;
    }
    if (!KEY.test(value)) {
      setError(SIGNUP.key.invalid);
      return;
    }
    setError(null);
    setStep(1);
  }

  function submitToken(e: React.FormEvent) {
    e.preventDefault();
    if (!TOKEN.test(token.trim())) {
      setError(SIGNUP.token.invalid);
      return;
    }
    setError(null);
    setHasBot(true);
    setStep(2);
  }

  function skipToken() {
    setError(null);
    setHasBot(false);
    setStep(2);
  }

  function restart() {
    setStep(0);
    setKey("");
    setToken("");
    setHasBot(false);
    setError(null);
  }

  return (
    <div className="mx-auto w-full max-w-[560px] rounded-[28px] bg-canvas p-2 ring-1 ring-hairline-soft shadow-[0_24px_60px_-32px_rgba(20,20,20,0.35)]">
      <div className="rounded-[22px] bg-canvas-soft p-6 sm:p-8">
        {/* Where you are, in two words each. */}
        <ol className="flex items-center gap-2 text-[12px] font-semibold">
          {SIGNUP.steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`grid size-5 place-items-center rounded-full text-[11px] tnum ${
                  i <= step
                    ? "bg-ink text-white"
                    : "bg-canvas text-faint ring-1 ring-hairline"
                }`}
              >
                {i + 1}
              </span>
              <span className={i <= step ? "text-ink" : "text-faint"}>{s}</span>
              {i < SIGNUP.steps.length - 1 && (
                <span className="mx-1 h-px w-4 bg-hairline sm:w-6" aria-hidden />
              )}
            </li>
          ))}
        </ol>

        <div className="mt-6 text-left">
          <AnimatePresence mode="wait" initial={false}>
            {step === 0 && (
              <Panel key="key">
                <form onSubmit={submitKey} noValidate>
                  <label
                    htmlFor="openrouter-key"
                    className="block text-[15px] font-semibold"
                  >
                    {SIGNUP.key.label}
                  </label>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Create a key on{" "}
                    <a
                      href={LINKS.openRouter}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink"
                    >
                      {SIGNUP.key.linkLabel}
                    </a>
                    , set a spending limit, and paste it here. You pay OpenRouter
                    directly for whatever your agent uses.
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      id="openrouter-key"
                      name="openrouter-key"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      aria-invalid={error ? "true" : undefined}
                      aria-describedby={error ? "signup-error" : undefined}
                      placeholder={SIGNUP.key.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                      className="h-12 w-full rounded-full bg-canvas px-5 text-[15px] ring-1 ring-hairline outline-none transition-[box-shadow] placeholder:text-faint focus:ring-2 focus:ring-ink"
                    />
                    <button
                      type="submit"
                      className="h-12 shrink-0 rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink-soft"
                    >
                      {SIGNUP.key.cta}
                    </button>
                  </div>
                </form>
              </Panel>
            )}

            {step === 1 && (
              <Panel key="token">
                <form onSubmit={submitToken} noValidate>
                  <label
                    htmlFor="bot-token"
                    className="block text-[15px] font-semibold"
                  >
                    {SIGNUP.token.label}
                  </label>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Message{" "}
                    <a
                      href={LINKS.botFather}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink"
                    >
                      {SIGNUP.token.linkLabel}
                    </a>
                    , send <span className="font-semibold text-ink">/newbot</span>
                    , and copy the token it replies with. Your agent takes its
                    name from that bot, so there's nothing else to fill in.
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      id="bot-token"
                      name="bot-token"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      aria-invalid={error ? "true" : undefined}
                      aria-describedby={error ? "signup-error" : undefined}
                      placeholder={SIGNUP.token.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                      className="h-12 w-full rounded-full bg-canvas px-5 text-[15px] ring-1 ring-hairline outline-none transition-[box-shadow] placeholder:text-faint focus:ring-2 focus:ring-ink"
                    />
                    <button
                      type="submit"
                      className="h-12 shrink-0 rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink-soft"
                    >
                      {SIGNUP.token.cta}
                    </button>
                  </div>
                  {/* Step two is optional, exactly as "How it works" says. */}
                  <button
                    type="button"
                    onClick={skipToken}
                    className="mt-3 text-sm font-semibold text-faint underline decoration-hairline underline-offset-4 transition-colors hover:text-ink"
                  >
                    {SIGNUP.token.skip}
                  </button>
                </form>
              </Panel>
            )}

            {step === 2 && (
              <Panel key="done">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-ink text-white">
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <path
                        d="M1.5 6.4 4.4 9.3 10.5 3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div>
                    <p className="text-[15px] font-semibold">
                      {hasBot ? SIGNUP.done.withBot : SIGNUP.done.withoutBot}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                      {hasBot
                        ? SIGNUP.done.bodyWithBot
                        : SIGNUP.done.bodyWithoutBot}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <SubmitAction />
                  <button
                    type="button"
                    onClick={restart}
                    className="inline-flex h-12 items-center justify-center rounded-full bg-canvas px-6 text-sm font-semibold text-muted ring-1 ring-hairline transition-colors hover:text-ink"
                  >
                    {SIGNUP.done.restart}
                  </button>
                </div>
              </Panel>
            )}
          </AnimatePresence>

          {error && (
            <p
              id="signup-error"
              role="alert"
              className="mt-3 flex items-center gap-2 text-sm font-medium text-ink"
            >
              <span
                aria-hidden
                className="grid size-4 shrink-0 place-items-center rounded-full bg-ink text-[10px] font-bold text-white"
              >
                !
              </span>
              {error}
            </p>
          )}
        </div>
      </div>

      <p className="px-6 py-3 text-center text-[13px] text-faint">
        {SIGNUP.footnote}
      </p>
    </div>
  );
}

/**
 * Step three's action. There is no sign-up destination yet, so it renders as a
 * button that goes nowhere rather than a link that lies — see BROKEN-LINKS.md.
 */
function SubmitAction() {
  const className =
    "inline-flex h-12 items-center justify-center rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink-soft";

  if (!LINKS.signUp) {
    return (
      <button type="button" className={className}>
        {SIGNUP.done.cta}
      </button>
    );
  }

  return (
    <a href={LINKS.signUp} className={className}>
      {SIGNUP.done.cta}
    </a>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
