"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

const ITEMS = [
  {
    q: "Do I need my own OpenRouter key?",
    a: "Yes. There's no deployment-wide key. Each agent is given its own under Settings, and an agent without one can't answer.",
  },
  {
    q: "Which model does an agent use?",
    a: "Any model your OpenRouter key can reach. There's a default, and Settings lets you change it per agent — image input needs a model that can see.",
  },
  {
    q: "What happens when I delete an agent?",
    a: "Its sessions, files, memories and MCP connections go with it. Deleting a single session wipes that session's storage only.",
  },
  {
    q: "Who can open an agent?",
    a: "Only the addresses on that agent's list. Anyone else is told the agent doesn't exist, which is the honest answer from where they stand.",
  },
  {
    q: "Are Cloudflare costs included in what I see?",
    a: "No. The app shows LLM cost, because that's the number OpenRouter reports exactly. Cloudflare's costs are documented separately rather than estimated in the UI.",
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
