"use client";

import { useState } from "react";
import type { ActualUsage, Summary } from "@/lib/agent";
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

export function CostHeader({
  sessionId,
  summary,
  actual,
  actualError,
  onRefreshUsage,
}: {
  sessionId: string;
  summary: Summary | null;
  actual: ActualUsage | null;
  actualError: string | null;
  onRefreshUsage: () => void;
}) {
  const [open, setOpen] = useState(false);

  const llmCost = summary?.llm.cost_usd ?? 0;
  const cfCost = actual?.cost.cloudflareUsd ?? 0;

  return (
    <header className="border-b border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-center gap-6 px-6 py-3">
        <div className="mr-auto min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">{sessionId}</div>
          <div className="text-[11px] text-zinc-500">{summary?.llm.model ?? "…"}</div>
        </div>

        <Stat
          label="LLM cost"
          value={formatUsd(llmCost)}
          hint={`${formatCount(summary?.llm.prompt_tokens ?? 0)} in / ${formatCount(
            summary?.llm.completion_tokens ?? 0
          )} out`}
        />
        <Stat
          label="Cloudflare cost"
          value={actual ? formatUsd(cfCost) : "—"}
          hint={
            actual
              ? `${formatCount(actual.usage.requests)} DO reqs · ${actual.cost.gbSeconds.toFixed(4)} GB-s`
              : "not reported"
          }
        />
        <Stat label="Total" value={actual ? formatUsd(llmCost + cfCost) : formatUsd(llmCost)} />

        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-white"
        >
          {open ? "Hide" : "Breakdown"}
        </button>
      </div>

      {open && (
        <div className="border-t border-zinc-800 bg-zinc-900/50 px-6 py-4">
          {actualError && (
            <p className="mb-4 rounded-md border border-amber-900 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
              {actualError}
            </p>
          )}

          {actual && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-4">
              <Stat
                label="DO duration"
                value={formatUsd(actual.cost.lines.doDuration)}
                hint={`${formatMs(actual.usage.activeTimeUs / 1000)} active × 128 MB`}
              />
              <Stat
                label="DO requests"
                value={formatUsd(actual.cost.lines.doRequests)}
                hint={`${formatCount(actual.usage.requests)} @ $0.15/M`}
              />
              <Stat
                label="Rows written"
                value={formatUsd(actual.cost.lines.doRowsWritten)}
                hint={`${formatCount(actual.usage.storageWriteUnits)} @ $1.00/M`}
              />
              <Stat
                label="Rows read"
                value={formatUsd(actual.cost.lines.doRowsRead)}
                hint={`${formatCount(actual.usage.storageReadUnits)} @ $0.001/M`}
              />
              <Stat
                label="Worker requests"
                value={formatUsd(actual.cost.lines.workerRequests)}
                hint={`${formatCount(actual.usage.requests)} @ $0.30/M`}
              />
              <Stat label="CPU time" value={formatMs(actual.usage.cpuTimeUs / 1000)} hint="billed via duration" />
              <Stat
                label="Namespace storage"
                value={`${formatUsd(actual.cost.namespaceStorageUsdPerMonth)}/mo`}
                hint={`${formatBytes(actual.usage.storedBytesNamespace)} across all sessions`}
              />
              <Stat label="Errors" value={formatCount(actual.usage.errors)} />
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button
              onClick={onRefreshUsage}
              className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-white"
            >
              Refresh Cloudflare usage
            </button>
            <span className="text-[10px] text-zinc-600">
              this session&apos;s SQLite: {formatBytes(summary?.sqlite_bytes ?? 0)}
            </span>
          </div>

          <p className="mt-4 max-w-3xl text-[11px] leading-relaxed text-zinc-500">
            LLM cost is exact — OpenRouter reports it per call. Cloudflare cost is Cloudflare&apos;s
            own reported usage priced at published rates, covering the last 24 hours for this
            object. It lags a few minutes and the underlying datasets are sampled
            {actual?.usage.sampled ? " (this response was sampled)" : ""}, so it will trail what you
            just sent. Stored bytes are only reported per namespace, never per object, so that line
            covers every session. None of this is billed until the Paid plan&apos;s monthly
            allowances — 1,000,000 DO requests, 400,000 GB-s, 5 GB — run out.
          </p>
        </div>
      )}
    </header>
  );
}
