/** Server-side access to the Cloudflare Worker that hosts the agent. */
export const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8787";

export type SessionRow = { id: string; title: string; created_at: number; updated_at: number };

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

/** Per-message usage, streamed to the client as a `data-usage` part. */
export type UsageData = {
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  llm_ms: number;
  do_active_ms?: number;
  rows_read?: number;
  rows_written?: number;
};

export type Metrics = {
  session: string;
  messages: number;
  usage: {
    do_requests: number;
    do_handler_active_ms: number;
    do_wall_clock_ms: number;
    do_rows_read: number;
    do_rows_written: number;
    sqlite_bytes: number;
    prompt_tokens: number;
    completion_tokens: number;
  };
  cost: {
    model: string;
    gbSeconds: number;
    storageGb: number;
    marginalUsd: {
      doRequests: number;
      doDuration: number;
      doRowsRead: number;
      doRowsWritten: number;
      doStorageMonth: number;
      workerRequests: number;
      llm: number;
    };
    cloudflareUsd: number;
    totalUsd: number;
    note: string;
  };
  capacity: { sessions: number | null; bindingLimit: string };
};

export function agentUrl(sessionId: string, path: string) {
  return `${AGENT_URL}/agents/session-agent/${encodeURIComponent(sessionId)}/${path}`;
}
