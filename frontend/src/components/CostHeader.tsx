"use client";

import { useState } from "react";
import type { ActualUsage, Summary } from "@/lib/agent";
import { formatBytes, formatCount, formatMs, formatUsd } from "@/lib/format";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-faint text-[12px] leading-[1.33]">{label}</div>
      <div className="text-ink tnum text-[20px] font-[650] leading-[1.3]">{value}</div>
      {hint && <div className="text-muted tnum text-[12px] leading-[1.33]">{hint}</div>}
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
    <header className="border-hairline-soft bg-canvas border-b">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4 px-8 pt-6 pb-5">
        <div className="mr-auto min-w-0">
          <div className="truncate text-2xl font-[650] leading-[1.25]">{sessionId}</div>
          <div className="text-muted truncate text-[14px] font-light leading-[1.43]">
            {summary?.llm.model ?? "…"}
          </div>
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
              ? `${formatCount(actual.usage.requests)} reqs · ${actual.cost.gbSeconds.toFixed(4)} GB-s`
              : "not reported yet"
          }
        />
        <Stat label="Total" value={actual ? formatUsd(llmCost + cfCost) : formatUsd(llmCost)} />

        <button
          onClick={() => setOpen((v) => !v)}
          className="border-hairline text-ink h-9 shrink-0 rounded-full border px-4 text-[14px] font-semibold transition hover:opacity-70"
        >
          {open ? "Hide" : "Breakdown"}
        </button>
      </div>

      {open && (
        <div className="border-hairline-soft bg-canvas-soft border-t px-8 py-6">
          {actualError && (
            <p className="border-hairline-soft bg-canvas text-muted mb-6 rounded-[16px] border px-4 py-3 text-[14px] leading-[1.43]">
              {actualError}
            </p>
          )}

          {actual && (
            <div className="grid grid-cols-2 gap-x-10 gap-y-5 md:grid-cols-4">
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
                hint={`${formatCount(actual.usage.rowsWritten)} @ $1.00/M`}
              />
              <Stat
                label="Rows read"
                value={formatUsd(actual.cost.lines.doRowsRead)}
                hint={`${formatCount(actual.usage.rowsRead)} @ $0.001/M`}
              />
              <Stat
                label="Worker requests"
                value={formatUsd(actual.cost.lines.workerRequests)}
                hint={`${formatCount(actual.usage.requests)} @ $0.30/M`}
              />
              <Stat
                label="CPU time"
                value={formatMs(actual.usage.cpuTimeUs / 1000)}
                hint="billed through duration"
              />
              <Stat
                label="Namespace storage"
                value={
                  actual.cost.namespaceStorageUsdPerMonth === null
                    ? "—"
                    : `${formatUsd(actual.cost.namespaceStorageUsdPerMonth)}/mo`
                }
                hint={
                  actual.usage.storedBytesNamespace === null
                    ? "not computed yet"
                    : `${formatBytes(actual.usage.storedBytesNamespace)}, all sessions`
                }
              />
              <Stat label="Errors" value={formatCount(actual.usage.errors)} />
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              onClick={onRefreshUsage}
              className="border-hairline text-ink h-9 rounded-full border px-4 text-[14px] font-semibold transition hover:opacity-70"
            >
              Refresh Cloudflare usage
            </button>
            <span className="text-faint tnum text-[12px] leading-[1.33]">
              this session&apos;s SQLite: {formatBytes(summary?.sqlite_bytes ?? 0)}
            </span>
          </div>

          <p className="text-muted mt-6 max-w-3xl text-[14px] font-light leading-[1.43]">
            LLM cost is exact — OpenRouter reports it per call. Cloudflare cost is Cloudflare&apos;s
            own reported usage for this object over the last 24 hours, priced at published rates. It
            lags a few minutes and the datasets are sampled
            {actual?.usage.sampled ? " (this response was sampled)" : ""}, so it trails what you just
            sent. Stored bytes are reported per namespace only, never per object, and on a slow
            cadence — a namespace deployed today shows nothing there for a while.
            None of it is billed until the Paid plan&apos;s monthly allowances — 1,000,000 requests,
            400,000 GB-s, 5 GB — run out.
          </p>
        </div>
      )}
    </header>
  );
}
