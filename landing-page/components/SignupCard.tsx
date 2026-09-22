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
  const [step, setStep] = useState(2);
  const [key, setKey] = useState("");
  const [token, setToken] = useState("");
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
    setStep(2);
  }

  function skipStep(step: number) {
    setError(null);
    if (step == 0) {
      setStep(1);
    } else if (step == 1) {
      setStep(2);
    }
  }

  function restart() {
    setStep(0);
    setKey("");
    setToken("");
    setError(null);
  }

  return (
    <div className="mx-auto w-full max-w-140 rounded-[28px] bg-canvas p-2 ring-1 ring-hairline-soft shadow-[0_24px_60px_-32px_rgba(20,20,20,0.35)]">
      <div className="rounded-[22px] bg-canvas-soft p-6 sm:p-8">
        {/* Where you are, in two words each. Narrow screens only fit one
            label, so the rest stay as numbered dots. */}
        <ol className="flex items-center justify-center gap-2 text-[12px] font-semibold sm:justify-start">
          {SIGNUP.steps.map((s, i) => (
            <li key={s} className="flex min-w-0 items-center gap-2">
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] tnum ${
                  i <= step
                    ? "bg-ink text-white"
                    : "bg-canvas text-faint ring-1 ring-hairline"
                }`}
              >
                {i + 1}
              </span>
              <span
                className={`truncate whitespace-nowrap ${
                  i === step ? "inline" : "hidden sm:inline"
                } ${i <= step ? "text-ink" : "text-faint"}`}
              >
                {s}
              </span>
              {i < SIGNUP.steps.length - 1 && (
                <span
                  className="mx-1 h-px w-3 shrink-0 bg-hairline sm:w-6"
                  aria-hidden
                />
              )}
            </li>
          ))}
        </ol>

        <div className="mt-6 text-left">
          <AnimatePresence mode="wait" initial={false}>
            {step === 0 && (
              <Panel key="key">
                <form onSubmit={submitKey} noValidate>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Create an account on{" "}
                    <a
                      href={LINKS.openRouter}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink"
                    >
                      {SIGNUP.key.linkLabel}
                    </a>
                    , set a spending limit, and get an API key.
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
                      className="h-12 w-full rounded-full bg-canvas px-5 text-[15px] ring-1 ring-hairline outline-none transition-shadow placeholder:text-faint focus:ring-2 focus:ring-ink"
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
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Find{" "}
                    <a
                      href={LINKS.botFather}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink"
                    >
                      {SIGNUP.token.linkLabel}
                    </a>{" "}
                    on telegram, send{" "}
                    <span className="font-semibold text-ink">/newbot</span>{" "}
                    command, and complete all the steps. You will get a Bot
                    Token.
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
                      className="h-12 w-full rounded-full bg-canvas px-5 text-[15px] ring-1 ring-hairline outline-none transition-shadow placeholder:text-faint focus:ring-2 focus:ring-ink"
                    />
                    <button
                      type="submit"
                      className="h-12 shrink-0 rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink-soft"
                    >
                      {SIGNUP.token.cta}
                    </button>
                  </div>
                </form>
              </Panel>
            )}

            {step === 2 && (
              <Panel key="done">
                <div className="flex flex-col items-center">
                  <div className="flex mt-3 items-center gap-2 justify-center">
                    <span className="-mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-ink text-white">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        aria-hidden="true"
                      >
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
                    <p className="text-[24px] font-semibold">
                      {SIGNUP.done.label}
                    </p>
                  </div>
                  <div>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                      {SIGNUP.done.body}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex justify-center flex-col gap-2 sm:flex-row">
                  <SubmitAction />
                  {/* Icon-only, so the one filled action keeps the width. */}
                  <button
                    type="button"
                    onClick={restart}
                    aria-label={SIGNUP.done.restart}
                    title={SIGNUP.done.restart}
                    className="inline-grid size-12 shrink-0 place-items-center rounded-full bg-canvas text-muted ring-1 ring-hairline transition-colors hover:text-ink"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1.06 6.74 2.74L21 8" />
                      <path d="M21 3v5h-5" />
                    </svg>
                  </button>
                </div>
              </Panel>
            )}
          </AnimatePresence>

          {error && (
            <p
              id="signup-error"
              role="alert"
              className="mt-2 w-full text-sm text-center font-light text-ink"
            >
              {error}
            </p>
          )}

          {/* Step two is optional, exactly as "How it works" says. */}
          {step !== 2 && (
            <div className="w-full flex justify-center">
              <button
                type="button"
                onClick={() => skipStep(step)}
                className="mt-3 text-sm font-semibold text-faint underline decoration-hairline underline-offset-4 transition-colors hover:text-ink"
              >
                {SIGNUP.token.skip}
              </button>
            </div>
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
