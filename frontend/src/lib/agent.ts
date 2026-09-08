/** Server-side access to the Cloudflare Worker that hosts the agent. */
export const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8787";

export type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  object_id: string;
};

export type StoredMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  ts: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  ms: number;
};

/**
 * Per-message usage, streamed to the client as a `data-usage` part.
 * Token counts and cost come from OpenRouter, so they are exact and immediate.
 * There is deliberately no Cloudflare figure here: its analytics lag minutes, so a
 * per-message Cloudflare cost could only ever be a guess.
 */
export type UsageData = {
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  llm_ms: number;
};

/** What the session knows about itself: transcript size and exact LLM spend. */
export type Summary = {
  session: string;
  messages: number;
  llm: { model: string; prompt_tokens: number; completion_tokens: number; cost_usd: number };
  sqlite_bytes: number;
};

/** Durable Object usage as reported by Cloudflare, priced at published rates. */
export type ActualUsage = {
  session: string;
  usage: {
    requests: number;
    errors: number;
    activeTimeUs: number;
    cpuTimeUs: number;
    subrequests: number;
    rowsRead: number;
    rowsWritten: number;
    storedBytesNamespace: number | null;
    sampled: boolean;
  };
  cost: {
    gbSeconds: number;
    lines: {
      doRequests: number;
      doDuration: number;
      doRowsRead: number;
      doRowsWritten: number;
      workerRequests: number;
    };
    cloudflareUsd: number;
    namespaceStorageUsdPerMonth: number | null;
  };
};

export function agentUrl(sessionId: string, path: string) {
  return `${AGENT_URL}/agents/session-agent/${encodeURIComponent(sessionId)}/${path}`;
}
