import Link from "next/link";

import { BRAND } from "./content";
import { LEGAL, type LegalDoc, type LegalTable } from "./legal";
import { Wrap } from "./ui";

/**
 * The shell both legal pages share.
 *
 * It does not reuse SiteHeader or SiteFooter: those navigate by fragment into the
 * landing page's sections, and every one of those links is dead on a route that has
 * no such sections. This is the same ink-on-canvas surface with a bar at each end
 * that goes home instead.
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="bg-canvas text-ink">
      <header className="border-b border-hairline-soft">
        <Wrap className="flex h-16 items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-[10px] bg-ink">
              <span className="grid grid-cols-2 gap-[3px]">
                <span className="size-[5px] rounded-[1.5px] bg-white" />
                <span className="size-[5px] rounded-[1.5px] bg-white/45" />
                <span className="size-[5px] rounded-[1.5px] bg-white/45" />
                <span className="size-[5px] rounded-[1.5px] bg-white" />
              </span>
            </span>
            <span className="text-[17px] font-[650] tracking-[-0.02em]">
              {BRAND.name}
            </span>
          </Link>
          <Link
            href="/"
            className="text-sm font-semibold text-muted transition-colors hover:text-ink"
          >
            Back to site
          </Link>
        </Wrap>
      </header>

      <main>
        <Wrap className="py-14 sm:py-20">
          <div className="max-w-[720px]">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">
              Last updated {LEGAL.updated}
            </p>
            <h1 className="mt-3 text-[clamp(30px,5vw,44px)] font-[650] leading-[1.08] tracking-[-0.03em]">
              {doc.title}
            </h1>
            <p className="mt-5 text-[17px] leading-relaxed text-muted">
              {doc.intro}
            </p>

            {/* Jump list: these documents are read by search, not by scroll. */}
            <nav
              aria-label="Sections"
              className="mt-8 rounded-[24px] bg-canvas-soft p-5 sm:p-6"
            >
              <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {doc.sections.map((s) => (
                  <li key={s.heading}>
                    <a
                      href={`#${slug(s.heading)}`}
                      className="text-sm text-muted transition-colors hover:text-ink"
                    >
                      {s.heading}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="mt-4">
              {doc.sections.map((s, i) => (
                <section
                  key={s.heading}
                  id={slug(s.heading)}
                  className="scroll-mt-8 border-t border-hairline-soft py-8"
                >
                  <h2 className="text-[20px] font-[650] leading-[1.25] tracking-[-0.015em]">
                    {s.heading}
                  </h2>
                  {/* The plain-English line first: the clause restated for a reader
                      who is not going to read the clause. */}
                  <p className="mt-3 border-l-2 border-hairline pl-4 text-[15px] leading-relaxed text-muted">
                    {s.summary}
                  </p>

                  {/* Clauses are numbered against the section they sit in, so a
                      cross-reference written as "clause 10.4" resolves on the page. */}
                  <ol className="mt-5 space-y-4">
                    {s.clauses.map((c, j) => (
                      <li key={c} className="flex gap-3 text-[15px] leading-relaxed">
                        <span className="tnum shrink-0 pt-px text-[13px] text-faint">
                          {i + 1}.{j + 1}
                        </span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ol>

                  {s.list && (
                    <ul className="mt-4">
                      {s.list.map((item) => (
                        <li
                          key={item}
                          className="border-t border-hairline-soft py-3 text-[15px] leading-relaxed"
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}

                  {s.table && <Table table={s.table} />}
                </section>
              ))}
            </div>
          </div>
        </Wrap>
      </main>

      <footer className="border-t border-hairline-soft">
        <Wrap className="flex flex-col gap-3 py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {BRAND.year} {BRAND.legalName}
          </span>
          <span className="flex gap-5">
            <Link href="/" className="transition-colors hover:text-ink">
              Home
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-ink">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-ink">
              Terms
            </Link>
          </span>
        </Wrap>
      </footer>
    </div>
  );
}

/**
 * A disclosure table — data categories, legal bases, sub-processors, retention.
 * On a phone it becomes one stacked block per row, each cell labelled by its own
 * column heading, because a four-column table at 360px is unreadable.
 */
function Table({ table }: { table: LegalTable }) {
  return (
    <div className="mt-6 overflow-hidden rounded-[16px] ring-1 ring-hairline-soft">
      <p className="bg-canvas-soft px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-faint">
        {table.caption}
      </p>

      <table className="hidden w-full border-collapse text-left align-top text-[14px] sm:table">
        <thead>
          <tr className="border-t border-hairline-soft">
            {table.head.map((h) => (
              <th key={h} className="px-4 py-3 text-[13px] font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.join("|")} className="border-t border-hairline-soft">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={`px-4 py-3 align-top leading-relaxed ${i === 0 ? "font-medium" : "text-muted"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sm:hidden">
        {table.rows.map((row) => (
          <div key={row.join("|")} className="border-t border-hairline-soft px-4 py-4">
            {row.map((cell, i) => (
              <div key={i} className={i > 0 ? "mt-2" : ""}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                  {table.head[i]}
                </p>
                <p className="mt-0.5 text-[14px] leading-relaxed">{cell}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Heading -> anchor. "3. Accounts and access" becomes "accounts-and-access". */
function slug(heading: string): string {
  return heading
    .replace(/^\d+\.\s*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
