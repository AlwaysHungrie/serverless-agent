"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { useState } from "react";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#costs", label: "Costs" },
  { href: "#capabilities", label: "Capabilities" },
  { href: "#faq", label: "FAQ" },
];

function Mark() {
  return (
    <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-ink">
      {/* Salt: four grains on a dark tile. */}
      <span className="grid grid-cols-2 gap-[3px]">
        <span className="size-[5px] rounded-[1.5px] bg-white" />
        <span className="size-[5px] rounded-[1.5px] bg-white/45" />
        <span className="size-[5px] rounded-[1.5px] bg-white/45" />
        <span className="size-[5px] rounded-[1.5px] bg-white" />
      </span>
    </span>
  );
}

export function SiteHeader() {
  const { scrollY } = useScroll();
  const [lifted, setLifted] = useState(false);
  const [open, setOpen] = useState(false);

  useMotionValueEvent(scrollY, "change", (y) => setLifted(y > 12));

  return (
    <header className="fixed inset-x-0 top-0 z-50 pt-3 sm:pt-5">
      <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-6">
        <motion.div
          // Flat and open at rest; a bordered glass slab once the page moves.
          animate={{
            backgroundColor: lifted ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0)",
            paddingTop: lifted ? 8 : 4,
            paddingBottom: lifted ? 8 : 4,
          }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={`flex items-center gap-3 rounded-[20px] pl-3 pr-3 backdrop-blur-xl transition-shadow ${
            lifted ? "ring-1 ring-hairline-soft" : "ring-0"
          }`}
        >
          <a href="#top" className="flex items-center gap-2.5 py-1.5">
            <Mark />
            <span className="text-[17px] font-[650] tracking-[-0.02em]">Salt Agents</span>
            <span className="hidden items-center gap-1.5 rounded-full bg-canvas-soft px-2.5 py-1 text-[11px] font-semibold text-muted sm:inline-flex">
              <span className="size-1.5 rounded-full bg-accent" />
              On Durable Objects
            </span>
          </a>

          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-full px-3.5 py-2 text-[15px] font-semibold text-muted transition-colors hover:bg-canvas-soft hover:text-ink"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-3">
            <a
              href="#"
              className="hidden rounded-full px-3.5 py-2 text-[15px] font-semibold text-muted transition-colors hover:text-ink sm:block"
            >
              Sign in
            </a>
            <a
              href="#"
              className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-soft"
            >
              Create an agent
            </a>
            <button
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="grid size-10 place-items-center rounded-full ring-1 ring-hairline md:hidden"
            >
              <span className="flex flex-col gap-1">
                <span className="h-px w-4 bg-ink" />
                <span className="h-px w-4 bg-ink" />
              </span>
            </button>
          </div>
        </motion.div>

        <AnimatePresence>
          {open && (
            <motion.nav
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="mt-2 overflow-hidden rounded-[20px] bg-white/95 p-2 ring-1 ring-hairline-soft backdrop-blur-xl md:hidden"
            >
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-2xl px-4 py-3 text-[15px] font-semibold text-muted hover:bg-canvas-soft hover:text-ink"
                >
                  {l.label}
                </a>
              ))}
              <a
                href="#"
                className="block rounded-2xl px-4 py-3 text-[15px] font-semibold text-muted hover:bg-canvas-soft hover:text-ink"
              >
                Sign in
              </a>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
