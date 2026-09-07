/**
 * Cloudflare pricing constants (Workers Paid plan, Durable Objects SQLite backend).
 * Source: https://developers.cloudflare.com/durable-objects/platform/pricing/
 * and https://developers.cloudflare.com/workers/platform/pricing/
 */
export const PRICING = {
  // Durable Objects
  doRequestsPerMillion: 0.15,
  doGbSecondsPerMillion: 12.5,
  doRowsReadPerMillion: 0.001,
  doRowsWrittenPerMillion: 1.0,
  doStorageGbMonth: 0.2,
  // A Durable Object is billed for a fixed 128 MB of memory while it is active,
  // regardless of what it actually uses. It is active while it runs JavaScript or
  // waits on a subrequest, and while any non-hibernatable WebSocket is open. An idle
  // object that qualifies for hibernation stops accruing duration immediately.
  doMemoryGb: 128 / 1024,

  // Worker in front of the DO
  workerRequestsPerMillion: 0.3,
  workerCpuPerMillionMs: 0.02,

  // Monthly included allowances on the Paid plan
  included: {
    doRequests: 1_000_000,
    doGbSeconds: 400_000,
    doRowsRead: 25_000_000_000,
    doRowsWritten: 50_000_000,
    doStorageGb: 5,
    workerRequests: 10_000_000,
  },

  planBaseUsd: 5.0,
} as const;

/** OpenRouter price per token, filled from the API response when available. */
export const MODEL_FALLBACK_PRICE = {
  "deepseek/deepseek-v4-flash": { prompt: 0.000000088606, completion: 0.000000177212 },
} as const;

export type UsageTotals = {
  requests: number;
  activeMs: number;
  wallClockMs: number;
  rowsRead: number;
  rowsWritten: number;
  storageBytes: number;
  promptTokens: number;
  completionTokens: number;
  llmCostUsd: number;
};

export function estimateCost(u: UsageTotals, model: string) {
  const gbSeconds = (u.wallClockMs / 1000) * PRICING.doMemoryGb;
  const storageGb = u.storageBytes / 1e9;

  const marginal = {
    doRequests: (u.requests / 1e6) * PRICING.doRequestsPerMillion,
    doDuration: (gbSeconds / 1e6) * PRICING.doGbSecondsPerMillion,
    doRowsRead: (u.rowsRead / 1e6) * PRICING.doRowsReadPerMillion,
    doRowsWritten: (u.rowsWritten / 1e6) * PRICING.doRowsWrittenPerMillion,
    // Storage is a rate, not a one-off: this is the cost of holding this
    // session's bytes for a full month.
    doStorageMonth: storageGb * PRICING.doStorageGbMonth,
    workerRequests: (u.requests / 1e6) * PRICING.workerRequestsPerMillion,
    llm: u.llmCostUsd,
  };

  const cloudflareTotal =
    marginal.doRequests +
    marginal.doDuration +
    marginal.doRowsRead +
    marginal.doRowsWritten +
    marginal.doStorageMonth +
    marginal.workerRequests;

  const fmt = (n: number) => n.toLocaleString("en-US");

  return {
    model,
    gbSeconds,
    storageGb,
    /** Cost if these units are billed at the marginal (over-allowance) rate. */
    marginalUsd: marginal,
    cloudflareUsd: cloudflareTotal,
    totalUsd: cloudflareTotal + marginal.llm,
    note:
      "Marginal rates. On the $5/mo Workers Paid plan the first " +
      `${fmt(PRICING.included.doRequests)} DO requests, ` +
      `${fmt(PRICING.included.doGbSeconds)} GB-s, and ` +
      `${PRICING.included.doStorageGb} GB of storage each month are included, ` +
      "so a session this size costs $0 until those are exhausted.",
  };
}

/** How many sessions like this one fit inside the Paid plan allowances. */
export function sessionsIncludedPerMonth(u: UsageTotals) {
  const gbSeconds = (u.wallClockMs / 1000) * PRICING.doMemoryGb;
  const limits = [
    u.requests > 0 ? PRICING.included.doRequests / u.requests : Infinity,
    gbSeconds > 0 ? PRICING.included.doGbSeconds / gbSeconds : Infinity,
    u.rowsWritten > 0 ? PRICING.included.doRowsWritten / u.rowsWritten : Infinity,
    u.rowsRead > 0 ? PRICING.included.doRowsRead / u.rowsRead : Infinity,
  ];
  const binding = ["do_requests", "do_duration", "do_rows_written", "do_rows_read"][
    limits.indexOf(Math.min(...limits))
  ];
  const min = Math.min(...limits);
  // Infinity does not survive JSON; report it as null and let the caller say "unbounded".
  return { sessions: Number.isFinite(min) ? Math.floor(min) : null, bindingLimit: binding };
}
