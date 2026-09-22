import { BRAND, FOOTER } from "./content";
import { MaybeLink, Wrap } from "./ui";

/**
 * Fixed to the viewport floor. The page sheet scrolls up off it, so the footer
 * is uncovered rather than scrolled into — see the spacer in app/page.tsx.
 *
 * Copy and link targets live in ./content.ts.
 */
export function SiteFooter() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-0 flex h-(--footer-h) flex-col justify-between bg-ink pb-8 pt-12 text-white">
      <Wrap>
        <div className="grid gap-8 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              {/* Same dark tile as the header; a lift and a hairline keep it off the ink. */}
              <span className="grid size-8 place-items-center rounded-[10px] bg-ink-soft ring-1 ring-inset ring-white/14 shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset]">
                <span className="grid grid-cols-2 gap-0.75">
                  <span className="size-1.25 rounded-[1.5px] bg-white" />
                  <span className="size-1.25 rounded-[1.5px] bg-white/45" />
                  <span className="size-1.25 rounded-[1.5px] bg-white/45" />
                  <span className="size-1.25 rounded-[1.5px] bg-white" />
                </span>
              </span>
              <span className="text-[17px] font-[650] tracking-[-0.02em]">
                {BRAND.name}
              </span>
            </div>
            <p className="mt-3 max-w-[320px] text-sm leading-relaxed text-faint">
              {FOOTER.tagline}
            </p>
          </div>

          {FOOTER.columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">
                {col.title}
              </h4>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <MaybeLink
                      href={l.href}
                      className="text-sm text-faint transition-colors hover:text-white"
                    >
                      {l.label}
                    </MaybeLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Wrap>

      <Wrap>
        <div className="flex flex-col gap-3 border-t border-white/12 pt-5 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {BRAND.year} {BRAND.legalName}
          </span>
          <span>{FOOTER.note}</span>
        </div>
      </Wrap>
    </footer>
  );
}
