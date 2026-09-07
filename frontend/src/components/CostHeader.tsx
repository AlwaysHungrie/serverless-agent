"use client";

import { useState } from "react";
import type { Metrics } from "@/lib/agent";
import { formatBytes, formatCount, formatMs, formatUsd } from "@/lib/format";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="font-mono text-sm text-zinc-100">{value}</div>
      {hint && <div className="text-[10px] text-zinc-600">{hint}</div>}
    </div>
  );
}

export function CostHeader({ sessionId, metrics }: { sessionId: string; metrics: Metrics | null }) {
  const [open, setOpen] = useState(false);

  const cost = metrics?.cost;
  const usage = metrics?.usage;

  return (
    <header className="border-b border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-center gap-6 px-6 py-3">
        <div className="mr-auto min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">{sessionId}</div>
          <div className="text-[11px] text-zinc-500">{cost?.model ?? "…"}</div>
        </div>

        <Stat
          label="LLM cost"
          value={formatUsd(cost?.marginalUsd.llm ?? 0)}
          hint={`${formatCount(usage?.prompt_tokens ?? 0)} in / ${formatCount(usage?.completion_tokens ?? 0)} out`}
        />
        <Stat
          label="Cloudflare cost"
          value={formatUsd(cost?.cloudflareUsd ?? 0)}
          hint={`${formatCount(usage?.do_requests ?? 0)} DO reqs · ${(cost?.gbSeconds ?? 0).toFixed(4)} GB-s`}
        />
        <Stat label="Total" value={formatUsd(cost?.totalUsd ?? 0)} />

        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-white"
        >
          {open ? "Hide" : "Breakdown"}
        </button>
      </div>

      {open && metrics && cost && usage && (
        <div className="border-t border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-4">
            <Stat
              label="DO duration"
              value={formatUsd(cost.marginalUsd.doDuration)}
              hint={`${formatMs(usage.do_wall_clock_ms)} resident × 128 MB`}
            />
            <Stat
              label="DO requests"
              value={formatUsd(cost.marginalUsd.doRequests)}
              hint={`${formatCount(usage.do_requests)} @ $0.15/M`}
            />
            <Stat
              label="Rows written"
              value={formatUsd(cost.marginalUsd.doRowsWritten)}
              hint={`${formatCount(usage.do_rows_written)} @ $1.00/M`}
            />
            <Stat
              label="Rows read"
              value={formatUsd(cost.marginalUsd.doRowsRead)}
              hint={`${formatCount(usage.do_rows_read)} @ $0.001/M`}
            />
            <Stat
              label="Storage / month"
              value={formatUsd(cost.marginalUsd.doStorageMonth)}
              hint={`${formatBytes(usage.sqlite_bytes)} @ $0.20/GB-mo`}
            />
            <Stat
              label="Worker requests"
              value={formatUsd(cost.marginalUsd.workerRequests)}
              hint={`${formatCount(usage.do_requests)} @ $0.30/M`}
            />
            <Stat
              label="Sessions included"
              value={
                metrics.capacity.sessions === null
                  ? "—"
                  : `${formatCount(metrics.capacity.sessions)}/mo`
              }
              hint={`limited by ${metrics.capacity.bindingLimit}`}
            />
            <Stat label="Messages" value={formatCount(metrics.messages)} />
          </div>
          <p className="mt-4 max-w-3xl text-[11px] leading-relaxed text-zinc-500">
            Marginal rates. The $5/month Workers Paid plan includes 1,000,000 DO requests,
            400,000 GB-s of duration and 5 GB of storage, so a session this size adds nothing
            until those run out. A Durable Object is billed for 128 MB of memory only while it is
            active — running code or waiting on the model — and stops accruing duration as soon as
            it goes idle and can hibernate. That is why the cost here is dominated by the seconds
            spent waiting for tokens.
          </p>
        </div>
      )}
    </header>
  );
}
