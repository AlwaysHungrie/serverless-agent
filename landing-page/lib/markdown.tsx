import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The markdown the docs are written in, rendered to the page's own type scale.
 *
 * It is deliberately small: headings, paragraphs, lists, tables, fenced code,
 * blockquotes, rules, and three inline forms — `code`, **bold**, and links. No
 * library, no HTML passthrough, no italics: an underscore in a config key or a
 * star in a shell glob must survive being written down.
 *
 * Nothing here knows where the markdown came from. `docs.ts` reads the files,
 * this turns a string into elements, and the page arranges them.
 */

/* ------------------------------------------------------------- headings -- */

export type Heading = { depth: 2 | 3; text: string; id: string };

/** Heading text -> anchor. "Set a spending limit" becomes "set-a-spending-limit". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The `##` and `###` headings of a document, in order, for the on-page contents.
 * Fenced code is skipped so a comment starting with `#` never becomes a section.
 */
export function headingsOf(markdown: string): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(##|###)\s+(.*)$/.exec(line);
    if (match) {
      const text = match[2].trim();
      out.push({ depth: match[1].length as 2 | 3, text, id: slugify(text) });
    }
  }
  return out;
}

/* --------------------------------------------------------------- inline -- */

/** `code`, **bold**, [text](href). Everything else is left as written. */
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;

  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const key = `${keyPrefix}-${match.index}`;

    if (match[1] !== undefined) {
      nodes.push(
        <code
          key={key}
          className="rounded-[6px] bg-canvas-soft px-1.5 py-0.5 font-mono text-[0.87em] text-ink"
        >
          {match[1]}
        </code>,
      );
    } else if (match[2] !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold text-ink">
          {match[2]}
        </strong>,
      );
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const href = match[4];
      const external = /^https?:\/\//.test(href);
      nodes.push(
        external ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent underline decoration-accent/30 underline-offset-[3px] transition-colors hover:decoration-accent"
          >
            {match[3]}
          </a>
        ) : (
          <Link
            key={key}
            href={href}
            className="font-medium text-accent underline decoration-accent/30 underline-offset-[3px] transition-colors hover:decoration-accent"
          >
            {match[3]}
          </Link>
        ),
      );
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/* --------------------------------------------------------------- blocks -- */

type Block =
  | { kind: "heading"; depth: 1 | 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "rule" };

const cells = (row: string): string[] =>
  row
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());

const isTableRow = (line: string) => line.trim().startsWith("|");
const isDivider = (line: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");

/**
 * Lines to blocks, one pass, no lookahead beyond the run being consumed.
 * A list item may wrap onto the next line; anything else ends the block.
 */
function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // the closing fence
      blocks.push({ kind: "code", lang, lines: body });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        depth: heading[1].length as 1 | 2 | 3 | 4,
        text: heading[2].trim(),
      });
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    if (line.trimStart().startsWith("> ") || line.trim() === ">") {
      const body: string[] = [];
      while (i < lines.length && (lines[i].trimStart().startsWith(">") || lines[i].trim() !== "")) {
        if (!lines[i].trimStart().startsWith(">")) break;
        body.push(lines[i].trimStart().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", lines: body });
      continue;
    }

    const bullet = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const next = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (next && /\d/.test(next[1]) === ordered) {
          items.push(next[2].trim());
          i += 1;
          continue;
        }
        // A wrapped item: indented text under the bullet above it.
        if (items.length > 0 && /^\s{2,}\S/.test(lines[i]) && !next) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !isTableRow(lines[i]) &&
      !lines[i].trimStart().startsWith(">") &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

/* ------------------------------------------------------------- renderer -- */

/** A parsed document, drawn. Headings carry the ids the contents list links to. */
export function Markdown({ source }: { source: string }) {
  const blocks = parse(source);

  return (
    <div className="text-[16px] leading-[1.65] text-muted">
      {blocks.map((block, index) => (
        <Block key={index} block={block} index={index} />
      ))}
    </div>
  );
}

function Block({ block, index }: { block: Block; index: number }) {
  switch (block.kind) {
    case "heading": {
      const id = slugify(block.text);
      if (block.depth <= 2) {
        return (
          <h2
            id={id}
            className="scroll-mt-24 border-t border-hairline-soft pt-9 mt-11 first:mt-0 first:border-0 first:pt-0 text-[24px] font-[650] leading-[1.2] tracking-[-0.02em] text-ink"
          >
            {inline(block.text, `h-${index}`)}
          </h2>
        );
      }
      if (block.depth === 3) {
        return (
          <h3
            id={id}
            className="scroll-mt-24 mt-8 text-[18px] font-[650] leading-[1.3] tracking-[-0.015em] text-ink"
          >
            {inline(block.text, `h-${index}`)}
          </h3>
        );
      }
      return (
        <h4 id={id} className="scroll-mt-24 mt-7 text-[16px] font-semibold text-ink">
          {inline(block.text, `h-${index}`)}
        </h4>
      );
    }

    case "paragraph":
      return <p className="mt-4">{inline(block.text, `p-${index}`)}</p>;

    case "list": {
      const items = block.items.map((item, j) => (
        <li key={j} className="pl-1.5">
          {inline(item, `li-${index}-${j}`)}
        </li>
      ));
      return block.ordered ? (
        <ol className="mt-4 list-decimal space-y-2 pl-5 marker:text-faint marker:text-[14px]">
          {items}
        </ol>
      ) : (
        <ul className="mt-4 list-disc space-y-2 pl-5 marker:text-faint">{items}</ul>
      );
    }

    case "code":
      return (
        <pre className="mt-5 overflow-x-auto rounded-[16px] bg-canvas-soft p-4 ring-1 ring-hairline-soft">
          <code className="font-mono text-[13px] leading-[1.6] text-ink">
            {block.lines.join("\n")}
          </code>
        </pre>
      );

    case "quote":
      return (
        <blockquote className="mt-5 rounded-[16px] bg-canvas-soft px-5 py-4 ring-1 ring-hairline-soft">
          {block.lines
            .join("\n")
            .split(/\n{2,}/)
            .map((paragraph, j) => (
              <p key={j} className={j === 0 ? "text-[15px]" : "mt-3 text-[15px]"}>
                {inline(paragraph.replace(/\n/g, " "), `q-${index}-${j}`)}
              </p>
            ))}
        </blockquote>
      );

    case "table":
      return <Table head={block.head} rows={block.rows} index={index} />;

    case "rule":
      return <hr className="mt-10 border-hairline-soft" />;
  }
}

/**
 * A table, and on a phone the same rows stacked — each cell labelled by its own
 * column heading, because a four-column table at 360px is unreadable.
 */
function Table({ head, rows, index }: { head: string[]; rows: string[][]; index: number }) {
  return (
    <div className="mt-6 overflow-hidden rounded-[16px] ring-1 ring-hairline-soft">
      <table className="hidden w-full border-collapse text-left align-top text-[14px] sm:table">
        <thead>
          <tr className="bg-canvas-soft">
            {head.map((cell, i) => (
              <th key={i} className="px-4 py-3 text-[13px] font-semibold text-ink">
                {inline(cell, `th-${index}-${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-hairline-soft">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-4 py-3 align-top leading-relaxed ${j === 0 ? "font-medium text-ink" : ""}`}
                >
                  {inline(cell, `td-${index}-${i}-${j}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sm:hidden">
        {rows.map((row, i) => (
          <div key={i} className="border-t border-hairline-soft px-4 py-4 first:border-0">
            {row.map((cell, j) => (
              <div key={j} className={j > 0 ? "mt-2" : ""}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                  {head[j]}
                </p>
                <p className="mt-0.5 text-[14px] leading-relaxed">
                  {inline(cell, `m-${index}-${i}-${j}`)}
                </p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
