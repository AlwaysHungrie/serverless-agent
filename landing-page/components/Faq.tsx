"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

const ITEMS = [
  {
    q: "Do I need to know how to code?",
    a: "No. If you can send a message on Telegram, you can set this up. The one technical-sounding bit — a bot token — is three taps in a Telegram chat, and we walk you through it.",
  },
  {
    q: "What is a bot token, exactly?",
    a: "It's the password that lets your agent use a Telegram account of its own. You get it from @BotFather, Telegram's official bot for making bots. Send /newbot, pick a name, and it replies with the token. Paste it here and you're done.",
  },
  {
    q: "Is my agent private?",
    a: "Yes. Your agent has its own memory and its own chats. Nobody else's agent can see them, and only people you invite can talk to yours.",
  },
  {
    q: "What does it cost?",
    a: "You pay for what your agent actually says. Each reply shows its cost, and everyday use usually lands under a few dollars a month. There's no subscription to cancel.",
  },
  {
    q: "Can I delete it?",
    a: "Any time, in one tap. Deleting a conversation wipes that conversation. Deleting the agent takes its memories and files with it.",
  },
  {
    q: "What's the 'one agent per person' thing about?",
    a: "We think everyone should have an AI that's theirs — not a shared assistant that treats you like a row in a database. So that's what we're building, one agent at a time.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto mt-12 max-w-[760px] space-y-2">
      {ITEMS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div
            key={item.q}
            className={`overflow-hidden rounded-[20px] transition-colors ${
              isOpen ? "bg-canvas-soft" : "bg-canvas ring-1 ring-hairline-soft"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left"
            >
              <span className="font-semibold">{item.q}</span>
              <motion.span
                animate={{ rotate: isOpen ? 45 : 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-muted ring-1 ring-hairline-soft"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </motion.span>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                >
                  <p className="px-6 pb-6 text-sm leading-relaxed text-muted">{item.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
