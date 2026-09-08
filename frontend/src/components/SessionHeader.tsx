"use client";

import type { Summary } from "@/lib/agent";
import { formatBytes, formatCount, formatUsd } from "@/lib/format";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-faint text-[12px] leading-[1.33]">{label}</div>
      <div className="text-ink tnum text-[20px] font-[650] leading-[1.3]">{value}</div>
      {hint && <div className="text-muted tnum text-[12px] leading-[1.33]">{hint}</div>}
    </div>
  );
}

/**
 * The session's own facts: which model, how much it has been used, what OpenRouter
 * charged. Cloudflare's costs are deliberately not shown — they cannot be measured
 * from inside the object, and their analytics lag. See
 * docs/cloudflare-durable-object-costs.md.
 */
export function SessionHeader({ sessionId, summary }: { sessionId: string; summary: Summary | null }) {
  return (
    <header className="border-hairline-soft bg-canvas border-b">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4 px-8 pt-6 pb-5">
        <div className="mr-auto min-w-0">
          <div className="truncate text-2xl font-[650] leading-[1.25]">{sessionId}</div>
          <div className="text-muted truncate text-[14px] font-light leading-[1.43]">
            {summary?.llm.model ?? "…"}
          </div>
        </div>

        <Stat
          label="Tokens"
          value={`${formatCount(summary?.llm.prompt_tokens ?? 0)} / ${formatCount(
            summary?.llm.completion_tokens ?? 0
          )}`}
          hint="in / out"
        />
        <Stat label="Messages" value={formatCount(summary?.messages ?? 0)} />
        <Stat
          label="LLM cost"
          value={formatUsd(summary?.llm.cost_usd ?? 0)}
          hint={`${formatBytes(summary?.sqlite_bytes ?? 0)} stored`}
        />
      </div>
    </header>
  );
}
