import { Wrap } from "./ui";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "#skills", label: "What it does" },
      { href: "#how", label: "How it works" },
      { href: "#costs", label: "Price" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "#mission", label: "The plan" },
      { href: "https://t.me/BotFather", label: "Get a Telegram token" },
      { href: "#faq", label: "FAQ" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "#", label: "Contact" },
      { href: "#", label: "Privacy" },
      { href: "#", label: "Terms" },
    ],
  },
];

/**
 * Fixed to the viewport floor. The page sheet scrolls up off it, so the footer
 * is uncovered rather than scrolled into — see the spacer in app/page.tsx.
 */
export function SiteFooter() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-0 flex h-[var(--footer-h)] flex-col justify-between bg-ink pb-8 pt-12 text-white">
      <Wrap>
        <div className="grid gap-8 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              {/* Same dark tile as the header; a lift and a hairline keep it off the ink. */}
              <span className="grid size-8 place-items-center rounded-[10px] bg-ink-soft ring-1 ring-inset ring-white/14 shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset]">
                <span className="grid grid-cols-2 gap-[3px]">
                  <span className="size-[5px] rounded-[1.5px] bg-white" />
                  <span className="size-[5px] rounded-[1.5px] bg-white/45" />
                  <span className="size-[5px] rounded-[1.5px] bg-white/45" />
                  <span className="size-[5px] rounded-[1.5px] bg-white" />
                </span>
              </span>
              <span className="text-[17px] font-[650] tracking-[-0.02em]">Salt Agents</span>
            </div>
            <p className="mt-3 max-w-[320px] text-sm leading-relaxed text-faint">
              An AI agent of your own, living in Telegram. One for every person on
              Earth — starting with yours.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">
                {col.title}
              </h4>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="text-sm text-faint transition-colors hover:text-white"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Wrap>

      <Wrap>
        <div className="flex flex-col gap-3 border-t border-white/12 pt-5 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Salt Agents</span>
          <span>Works wherever Telegram works</span>
        </div>
      </Wrap>
    </footer>
  );
}
