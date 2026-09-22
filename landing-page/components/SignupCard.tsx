"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

/**
 * The quick-start card in the hero. Three short steps — token, name, done —
 * so a visitor has their agent on Telegram before they have an account.
 * Nothing is sent anywhere yet; the last step hands off to sign-up.
 */

/** BotFather hands out tokens shaped `<digits>:<35 or so characters>`. */
const TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

const STEPS = ["Get a token", "Name your agent", "Say hello"];

export function TelegramSignup() {
  const [step, setStep] = useState(0);
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submitToken(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) {
      setError("Paste the token BotFather sent you.");
      return;
    }
    if (!TOKEN.test(token.trim())) {
      setError("That doesn't look like a token. Copy the whole line, numbers and all.");
      return;
    }
    setError(null);
    setStep(1);
  }

  function submitName(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("Give your agent a name — two letters is enough.");
      return;
    }
    setError(null);
    setStep(2);
  }

  return (
    <div className="mx-auto w-full max-w-[560px] rounded-[28px] bg-canvas p-2 ring-1 ring-hairline-soft shadow-[0_24px_60px_-32px_rgba(20,20,20,0.35)]">
      <div className="rounded-[22px] bg-canvas-soft p-6 sm:p-8">
        {/* Where you are, in three words each. */}
        <ol className="flex items-center gap-2 text-[12px] font-semibold">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`grid size-5 place-items-center rounded-full text-[11px] tnum ${
                  i <= step ? "bg-ink text-white" : "bg-canvas text-faint ring-1 ring-hairline"
                }`}
              >
                {i + 1}
              </span>
              <span className={i <= step ? "text-ink" : "text-faint"}>{s}</span>
              {i < STEPS.length - 1 && (
                <span className="mx-1 h-px w-4 bg-hairline sm:w-6" aria-hidden />
              )}
            </li>
          ))}
        </ol>

        <div className="mt-6 text-left">
          <AnimatePresence mode="wait" initial={false}>
            {step === 0 && (
              <Panel key="token">
                <form onSubmit={submitToken} noValidate>
                  <label
                    htmlFor="bot-token"
                    className="block text-[15px] font-semibold"
                  >
                    Paste your Telegram bot token
                  </label>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Message{" "}
                    <a
                      href="https://t.me/BotFather"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink"
                    >
                      @BotFather on Telegram
                    </a>
                    , send <span className="font-semibold text-ink">/newbot</span>, and
                    copy the token it replies with. Takes about a minute.
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      id="bot-token"
                      name="bot-token"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      aria-invalid={error ? "true" : undefined}
                      aria-describedby={error ? "signup-error" : undefined}
                      placeholder="8412345678:AAH…"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-12 w-full rounded-full bg-canvas px-5 text-[15px] ring-1 ring-hairline outline-none transition-[box-shadow] placeholder:text-faint focus:ring-2 focus:ring-ink"
                    />
                    <button
                      type="submit"
                      className="h-12 shrink-0 rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink-soft"
                    >
                      Continue
                    </button>
                  </div>
                </form>
              </Panel>
            )}

            {step === 1 && (
              <Panel key="name">
                <form onSubmit={submitName} noValidate>
                  <label htmlFor="agent-name" className="block text-[15px] font-semibold">
                    What should your agent be called?
                  </label>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    This is the name you'll see in your chats. You can change it later.
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      id="agent-name"
                      name="agent-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      aria-invalid={error ? "true" : undefined}
                      aria-describedby={error ? "signup-error" : undefined}
                      placeholder="Nova"
                      autoComplete="off"
                      className="h-12 w-full rounded-full bg-canvas px-5 text-[15px] ring-1 ring-hairline outline-none transition-[box-shadow] placeholder:text-faint focus:ring-2 focus:ring-ink"
                    />
                    <button
                      type="submit"
                      className="h-12 shrink-0 rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink-soft"
                    >
                      Continue
                    </button>
                  </div>
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
                      {name.trim()} is ready to wake up.
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                      Create your account and {name.trim()} starts answering in your
                      Telegram. Free to try, and you can delete it in one tap.
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <a
                    href="#"
                    className="inline-flex h-12 items-center justify-center rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink-soft"
                  >
                    Create my agent
                  </a>
                  <button
                    type="button"
                    onClick={() => setStep(0)}
                    className="inline-flex h-12 items-center justify-center rounded-full bg-canvas px-6 text-sm font-semibold text-muted ring-1 ring-hairline transition-colors hover:text-ink"
                  >
                    Start over
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
        No credit card. Your token stays yours — delete the agent and it's gone.
      </p>
    </div>
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
