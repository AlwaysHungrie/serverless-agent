import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DocsLayout } from "@/components/DocsLayout";
import { BRAND } from "@/components/content";
import { allDocs, getDoc, neighbours } from "@/lib/docs";
import { Markdown, headingsOf } from "@/lib/markdown";

/** One route per markdown file, generated at build time. */
export function generateStaticParams() {
  return allDocs().map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const doc = getDoc((await params).slug);
  if (!doc) return { title: `Docs — ${BRAND.name}` };
  return {
    title: `${doc.title} — ${BRAND.name} docs`,
    description: doc.summary,
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();

  const headings = headingsOf(doc.body).filter((h) => h.depth === 2);
  const { previous, next } = neighbours(slug);

  return (
    <DocsLayout current={slug}>
      <div className="flex gap-10">
        <article className="min-w-0 max-w-[720px] flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">
            {doc.section}
          </p>
          <h1 className="mt-3 text-[clamp(28px,4.5vw,40px)] font-[650] leading-[1.1] tracking-[-0.03em]">
            {doc.title}
          </h1>
          {doc.summary && (
            <p className="mt-4 text-[17px] leading-relaxed text-muted">{doc.summary}</p>
          )}

          {/* On a phone the contents sit above the article; on a wide screen the
              column on the right does the same job and this is hidden. */}
          {headings.length > 1 && (
            <nav
              aria-label="On this page"
              className="mt-8 rounded-[20px] bg-canvas-soft p-5 xl:hidden"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                On this page
              </p>
              <ul className="mt-2 space-y-1.5">
                {headings.map((h) => (
                  <li key={h.id}>
                    <a
                      href={`#${h.id}`}
                      className="text-sm text-muted transition-colors hover:text-ink"
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="mt-10">
            <Markdown source={doc.body} />
          </div>

          {(previous || next) && (
            <nav className="mt-14 grid gap-3 border-t border-hairline-soft pt-8 sm:grid-cols-2">
              {previous ? (
                <Link
                  href={`/docs/${previous.slug}`}
                  className="rounded-[16px] p-4 ring-1 ring-hairline-soft transition-colors hover:bg-canvas-soft"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                    Previous
                  </span>
                  <span className="mt-1 block text-[15px] font-semibold">{previous.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  href={`/docs/${next.slug}`}
                  className="rounded-[16px] p-4 text-right ring-1 ring-hairline-soft transition-colors hover:bg-canvas-soft"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                    Next
                  </span>
                  <span className="mt-1 block text-[15px] font-semibold">{next.title}</span>
                </Link>
              )}
            </nav>
          )}
        </article>

        {headings.length > 1 && (
          <aside className="hidden w-[200px] shrink-0 xl:block">
            <div className="sticky top-24 py-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                On this page
              </p>
              <ul className="mt-3 space-y-2 border-l border-hairline-soft">
                {headings.map((h) => (
                  <li key={h.id}>
                    <a
                      href={`#${h.id}`}
                      className="block border-l border-transparent -ml-px pl-3 text-[13px] leading-[1.4] text-muted transition-colors hover:border-ink hover:text-ink"
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>
    </DocsLayout>
  );
}
