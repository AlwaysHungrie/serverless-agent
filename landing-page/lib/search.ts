import { allDocs } from "./docs";
import { slugify } from "./markdown";

/**
 * The search index, built once on the server and handed to the dialog as a prop.
 *
 * One entry per `##` section rather than per article: a reader searching for
 * "whitelist" wants the paragraph about whitelists, not the article it sits in,
 * and a heading anchor puts them on it. The whole index is a few tens of
 * kilobytes, so there is nothing to fetch and nothing to keep in sync — it ships
 * with the page like the markdown it came from.
 */
export type SearchEntry = {
  /** Where it goes: `/docs/<slug>` plus the heading anchor, when there is one. */
  slug: string;
  hash: string;
  /** The article's title, always. */
  title: string;
  /** The section of the docs the article belongs to — "Start here", and so on. */
  group: string;
  /** The `##` heading this entry covers, empty for an article's opening. */
  heading: string;
  /** The prose, markdown stripped, for matching and for the snippet. */
  text: string;
};

/** Markdown to plain prose: what a reader sees, not what the file holds. */
function strip(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*$/gm, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*([-*]|\d+\.)\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];

  for (const doc of allDocs()) {
    // The opening of the article: its summary, plus whatever precedes the first
    // heading. This is the entry a search for the article's own name should hit.
    const [opening, ...rest] = doc.body.split(/^##\s+/m);
    entries.push({
      slug: doc.slug,
      hash: "",
      title: doc.title,
      group: doc.section,
      heading: "",
      text: `${doc.summary} ${strip(opening)}`.trim(),
    });

    for (const chunk of rest) {
      const newline = chunk.indexOf("\n");
      // Backticks are markup, and the dialog shows the heading as plain text.
      const heading = (newline === -1 ? chunk : chunk.slice(0, newline)).replace(/`/g, "").trim();
      const body = newline === -1 ? "" : chunk.slice(newline + 1);
      entries.push({
        slug: doc.slug,
        hash: slugify(heading),
        title: doc.title,
        group: doc.section,
        heading,
        text: strip(body),
      });
    }
  }

  return entries;
}
