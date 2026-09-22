import Link from "next/link";
import type { ReactNode } from "react";

import { BRAND } from "./content";
import { DocsSearch } from "./DocsSearch";
import { docSections } from "@/lib/docs";

/**
 * The shell every docs route shares: a bar that goes home, the article index down
 * the left, and whatever the route puts in the middle.
 *
 * Like the legal pages, it does not reuse SiteHeader — that header navigates by
 * fragment into the landing page's sections, and every one of those links is dead
 * here. The only interactive part is the search dialog, which is handed its index
 * as a prop from here; the mobile article index is a `<details>` and the sidebar
 * is a list of links, so neither costs any JavaScript.
 */
export function DocsLayout({
  children,
  /** The article being read, so its link is marked current. */
  current,
}: {
  children: ReactNode;
  current?: string;
}) {
  const sections = docSections();

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-20 border-b border-hairline-soft bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1320px] items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-[10px] bg-ink">
                <span className="grid grid-cols-2 gap-[3px]">
                  <span className="size-[5px] rounded-[1.5px] bg-white" />
                  <span className="size-[5px] rounded-[1.5px] bg-white/45" />
                  <span className="size-[5px] rounded-[1.5px] bg-white/45" />
                  <span className="size-[5px] rounded-[1.5px] bg-white" />
                </span>
              </span>
              <span className="text-[17px] font-[650] tracking-[-0.02em]">{BRAND.name}</span>
            </Link>
            <Link
              href="/docs"
              className="rounded-full bg-canvas-soft px-2.5 py-1 text-xs font-semibold tracking-[0.02em] text-muted transition-colors hover:text-ink"
            >
              Docs
            </Link>
          </div>
          <div className="flex items-center gap-4">
            {/* Its index is the static file at /docs/search-index.json. */}
            <DocsSearch />
            <Link
              href="/"
              className="hidden text-sm font-semibold text-muted transition-colors hover:text-ink sm:block"
            >
              Back to site
            </Link>
          </div>
        </div>
      </header>

      {/* The index, collapsed, above the article on a phone. */}
      <details className="border-b border-hairline-soft lg:hidden">
        <summary className="mx-auto flex w-full max-w-[1320px] cursor-pointer list-none items-center justify-between px-6 py-4 text-sm font-semibold">
          All articles
          <span aria-hidden="true" className="text-faint">
            ▾
          </span>
        </summary>
        <div className="mx-auto w-full max-w-[1320px] px-6 pb-6">
          <Index sections={sections} current={current} />
        </div>
      </details>

      <div className="mx-auto flex w-full max-w-[1320px] gap-10 px-6">
        <aside className="hidden w-[228px] shrink-0 lg:block">
          <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-10 pr-2">
            <Index sections={sections} current={current} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 py-10 sm:py-14">{children}</main>
      </div>

      <footer className="border-t border-hairline-soft">
        <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-3 px-6 py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {BRAND.year} {BRAND.legalName}
          </span>
          <span className="flex gap-5">
            <Link href="/" className="transition-colors hover:text-ink">
              Home
            </Link>
            <Link href="/docs" className="transition-colors hover:text-ink">
              Docs
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-ink">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-ink">
              Terms
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Index({
  sections,
  current,
}: {
  sections: ReturnType<typeof docSections>;
  current?: string;
}) {
  return (
    <nav aria-label="Documentation">
      {sections.map((section) => (
        <div key={section.title} className="mt-6 first:mt-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
            {section.title}
          </p>
          <ul className="mt-2 space-y-px">
            {section.docs.map((doc) => {
              const active = doc.slug === current;
              return (
                <li key={doc.slug}>
                  <Link
                    href={`/docs/${doc.slug}`}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-[10px] px-2.5 py-[7px] text-[14px] leading-[1.35] transition-colors ${
                      active
                        ? "bg-canvas-soft font-semibold text-ink"
                        : "text-muted hover:bg-canvas-soft hover:text-ink"
                    }`}
                  >
                    {doc.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
