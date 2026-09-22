import type { Metadata } from "next";
import Link from "next/link";

import { DocsLayout } from "@/components/DocsLayout";
import { BRAND } from "@/components/content";
import { allDocs, docSections } from "@/lib/docs";

export const metadata: Metadata = {
  title: `Docs — ${BRAND.name}`,
  description: `How to set up ${BRAND.name}, connect it to Telegram and your other tools, and get the most out of it.`,
};

export default function Page() {
  const sections = docSections();
  const first = allDocs()[0];

  return (
    <DocsLayout>
      <div className="max-w-[820px]">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">
          Documentation
        </p>
        <h1 className="mt-3 text-[clamp(30px,5vw,44px)] font-[650] leading-[1.08] tracking-[-0.03em]">
          Everything your agent can do, and how to switch it on.
        </h1>
        <p className="mt-5 text-[17px] leading-relaxed text-muted">
          Start with two keys: one from OpenRouter, one from Telegram. The rest of these
          pages cover things you turn on when you need them.
        </p>

        {first && (
          <Link
            href={`/docs/${first.slug}`}
            className="mt-7 inline-flex h-12 items-center justify-center rounded-full bg-ink px-6 font-semibold text-white transition-colors hover:bg-ink-soft"
          >
            Start reading
          </Link>
        )}

        <div className="mt-12 space-y-10">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-faint">
                {section.title}
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {section.docs.map((doc) => (
                  <li key={doc.slug}>
                    <Link
                      href={`/docs/${doc.slug}`}
                      className="block h-full rounded-[20px] p-5 ring-1 ring-hairline-soft transition-colors hover:bg-canvas-soft"
                    >
                      <p className="text-[16px] font-semibold leading-[1.3]">{doc.title}</p>
                      {doc.summary && (
                        <p className="mt-2 text-[14px] leading-[1.5] text-muted">{doc.summary}</p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </DocsLayout>
  );
}
