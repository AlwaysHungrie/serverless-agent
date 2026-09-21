import { Wrap } from "./ui";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "#how", label: "How it works" },
      { href: "#capabilities", label: "Capabilities" },
      { href: "#costs", label: "Costs" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "#", label: "Documentation" },
      { href: "#", label: "Architecture" },
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
    <footer className="fixed inset-x-0 bottom-0 z-0 flex h-[var(--footer-h)] flex-col justify-between bg-ink py-14 text-white">
      <Wrap>
        <div className="grid gap-10 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-[10px] bg-white">
                <span className="grid grid-cols-2 gap-[3px]">
                  <span className="size-[5px] rounded-[1.5px] bg-ink" />
                  <span className="size-[5px] rounded-[1.5px] bg-ink/40" />
                  <span className="size-[5px] rounded-[1.5px] bg-ink/40" />
                  <span className="size-[5px] rounded-[1.5px] bg-ink" />
                </span>
              </span>
              <span className="text-[17px] font-[650] tracking-[-0.02em]">Salt Agents</span>
            </div>
            <p className="mt-4 max-w-[320px] text-sm leading-relaxed text-faint">
              Chat agents that run one to a Durable Object, with the cost of every
              message in plain sight.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">
                {col.title}
              </h4>
              <ul className="mt-4 space-y-3">
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
        <div className="flex flex-col gap-3 border-t border-white/12 pt-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Salt Agents</span>
          <span>Built on Cloudflare Workers and Durable Objects</span>
        </div>
      </Wrap>
    </footer>
  );
}
