/**
 * The OpenRouter API keys screen, redrawn rather than screenshotted: the page
 * this section talks about, showing one workspace key with its spend and its
 * monthly ceiling. Every value here is fixed sample content.
 */

type Key = {
  name: string;
  secret: string;
  expires: string;
  lastUsed: string;
  usage: string;
  limit: string;
  period: string;
  /** Share of the limit spent, as the bar under the limit draws it. */
  spent: number;
};

const KEYS: Key[] = [
  {
    name: "salts:4ac067dd…",
    secret: "sk-or-v1-1ef…",
    expires: "Never",
    lastUsed: "1 day ago",
    usage: "$0.003",
    limit: "$5",
    period: "MONTH",
    spent: 0.02,
  },
];

const MIDDLE = ["Expires", "Last Used", "Key usage"] as const;

export function ApiKeysPreview({ className = "" }: { className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-[24px] bg-white text-[#0d0d0d] shadow-[0_18px_50px_-24px_rgba(20,20,20,0.25)] ring-1 ring-hairline ${className}`}
    >
      {/* Browser chrome, so a product shot reads as a product shot. */}
      <div className="flex items-center gap-1.5 border-b border-hairline-soft bg-white/60 px-4 py-3">
        <span className="size-2.5 rounded-full bg-hairline" />
        <span className="size-2.5 rounded-full bg-hairline" />
        <span className="size-2.5 rounded-full bg-hairline" />
        <span className="ml-3 flex h-5 min-w-0 items-center rounded-full bg-canvas-soft px-2.5 text-[10px] text-faint">
          openrouter.ai/settings/keys
        </span>
      </div>

      <div className="font-or bg-linear-to-b from-[#fafafa] to-white px-4 pt-5 pb-4 sm:px-5">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-[20px] font-bold leading-none tracking-[-0.01em] sm:text-[22px]">
            API Keys
          </h3>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#5a3ff2] px-2.5 py-1.5 text-[12px] font-semibold text-white">
            <PlusIcon />
            New Key
          </span>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#5c5c5c]">
          Create and manage API keys for this workspace.
          <InfoIcon />
        </p>
      </div>

      <div className="font-or mx-4 mb-4 overflow-hidden rounded-[14px] ring-1 ring-[#ececec] sm:mx-5 sm:mb-5">
        {/* Filter row */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1 ring-[#e6e6e6]">
            <SearchIcon />
            <span className="truncate text-[11px] text-[#a0a0a0]">
              Search by name or paste a key...
            </span>
          </div>
          <Chip label="Owner" />
          <Chip label="Expiration" caret />
        </div>

        {/* A real table: the header and both rows share one sizing context, so
            every value sits under its own heading whatever its width. */}
        <table className="w-full border-collapse text-left text-[11px] whitespace-nowrap text-[#3d3d3d]">
          <thead>
            <tr className="border-t border-[#ececec]">
              {/* The key column takes whatever the sized columns leave. */}
              <th className="w-full max-w-0 px-3 py-2.5 font-normal">Key</th>
              {MIDDLE.map((c) => (
                <th
                  key={c}
                  className="hidden px-3 py-2.5 font-normal sm:table-cell"
                >
                  {c}
                </th>
              ))}
              <th className="px-3 py-2.5 font-normal">Key limit</th>
            </tr>
          </thead>
          <tbody>
            {KEYS.map((k) => (
              <tr key={k.name} className="border-t border-[#ececec]">
                <td className="w-full max-w-0 px-3 py-3 align-middle">
                  <p className="truncate text-[12px] font-medium text-[#0d0d0d]">
                    {k.name}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px]">
                    {k.secret}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#5c5c5c]">
                    <BuildingIcon />
                    Salts
                  </p>
                </td>
                <td className="hidden px-3 py-3 align-middle sm:table-cell">
                  {k.expires}
                </td>
                <td className="hidden px-3 py-3 align-middle sm:table-cell">
                  {k.lastUsed}
                </td>
                <td className="hidden px-3 py-3 align-middle sm:table-cell">
                  {k.usage}
                </td>
                {/* Limit, the period it resets on, and the spend bar under both. */}
                <td className="px-3 py-3 align-middle">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[#0d0d0d]">
                      {k.limit}
                    </span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.02em] text-[#0d0d0d] ring-1 ring-hairline">
                      {k.period}
                    </span>
                  </div>
                  <div className="mt-1.5 h-0.75 rounded-full bg-[#ececec]">
                    <div
                      className="h-full rounded-full bg-[#0d0d0d]"
                      style={{ width: `${k.spent * 100}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Chip({ label, caret = false }: { label: string; caret?: boolean }) {
  return (
    <span className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-[#d6d6d6] px-2.5 py-1.5 text-[11px] text-[#3d3d3d] sm:inline-flex">
      <FilterIcon />
      {label}
      {caret ? <CaretIcon /> : null}
    </span>
  );
}

/* Icons are drawn inline so the card carries no image requests. */

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 text-[#a0a0a0]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.2v3.4M8 5.2v.6" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0 text-[#8a8a8a]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="7.2" cy="7.2" r="4.4" />
      <path d="M10.6 10.6 14 14" strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 text-[#5c5c5c]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M2 4.5h12M4 8h8M6 11.5h4" />
    </svg>
  );
}

function CaretIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3 text-[#5c5c5c]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 text-[#8a8a8a]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <path
        d="M2.5 13.5V3.2a.7.7 0 0 1 .7-.7h6.1a.7.7 0 0 1 .7.7v10.3M9.8 6.2h3a.7.7 0 0 1 .7.7v6.6M1.4 13.5h13.2"
        strokeLinecap="round"
      />
      <path d="M4.8 5.2h2.8M4.8 7.8h2.8M4.8 10.4h2.8" strokeLinecap="round" />
    </svg>
  );
}
