import fs from "node:fs";
import path from "node:path";

/**
 * The docs, as files.
 *
 * Everything the docs site says lives in `content/docs/*.md`. This module is the
 * only thing that reads them: it splits the frontmatter off, sorts the articles,
 * and groups them into the sections the sidebar draws. Adding an article means
 * adding one markdown file — no route, no import, no list to keep in sync.
 *
 * Frontmatter is four plain `key: value` lines:
 *
 *   ---
 *   title: Get an OpenRouter key
 *   section: Start here
 *   order: 3
 *   summary: One sentence, shown on the index and in the page description.
 *   ---
 */

export type Doc = {
  /** File name without the extension. Also the URL: `/docs/<slug>`. */
  slug: string;
  title: string;
  section: string;
  order: number;
  summary: string;
  /** The markdown, frontmatter removed. */
  body: string;
};

export type DocSection = { title: string; docs: Doc[] };

/**
 * Section order on the sidebar and on the index. A section not named here still
 * renders — it just sorts to the end, alphabetically — so a new group of articles
 * is never silently dropped.
 */
const SECTION_ORDER = [
  "Start here",
  "Everyday use",
  "Capabilities",
  "Connect other tools",
  "Control and access",
  "Limits and costs",
  "Run it yourself",
  "When something breaks",
];

const DIR = path.join(process.cwd(), "content", "docs");

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  for (const line of raw.slice(3, end).split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { meta, body: raw.slice(end + 4).replace(/^\n+/, "") };
}

let cache: Doc[] | null = null;

/** Every article, sorted by section order then by the `order` in its frontmatter. */
export function allDocs(): Doc[] {
  if (cache) return cache;

  const docs = fs
    .readdirSync(DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(DIR, name), "utf8"));
      const slug = name.replace(/\.md$/, "");
      return {
        slug,
        title: meta.title ?? slug,
        section: meta.section ?? "Start here",
        order: Number(meta.order ?? 999),
        summary: meta.summary ?? "",
        body,
      };
    });

  const rank = (section: string) => {
    const at = SECTION_ORDER.indexOf(section);
    return at === -1 ? SECTION_ORDER.length : at;
  };

  docs.sort(
    (a, b) =>
      rank(a.section) - rank(b.section) ||
      a.section.localeCompare(b.section) ||
      a.order - b.order ||
      a.title.localeCompare(b.title),
  );

  cache = docs;
  return docs;
}

/** The articles grouped for the sidebar, in reading order. */
export function docSections(): DocSection[] {
  const sections: DocSection[] = [];
  for (const doc of allDocs()) {
    const last = sections[sections.length - 1];
    if (last && last.title === doc.section) last.docs.push(doc);
    else sections.push({ title: doc.section, docs: [doc] });
  }
  return sections;
}

export function getDoc(slug: string): Doc | undefined {
  return allDocs().find((doc) => doc.slug === slug);
}

/** What comes before and after this article, so a reader can keep going. */
export function neighbours(slug: string): { previous?: Doc; next?: Doc } {
  const docs = allDocs();
  const at = docs.findIndex((doc) => doc.slug === slug);
  if (at === -1) return {};
  return { previous: docs[at - 1], next: docs[at + 1] };
}
