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
