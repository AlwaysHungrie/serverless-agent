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
  /** Files and images sent with this message, resolved by the Worker. */
  attachments: Attachment[];
  /** JSON array of `TurnStep`: how an assistant turn unfolded. `[]` when unused. */
  steps?: string;
};

/**
 * One segment of an assistant turn, in the order it happened — mirrors the Worker's
 * own type, so a reopened session redraws the tool lines the live stream showed.
 */
export type TurnStep =
  | { kind: "text"; text: string }
  | { kind: "tools"; tools: { name: string; ok: boolean }[] };

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
export type ModelOption = { id: string; label: string; vision: boolean };

export type ReasoningEffort = "off" | "low" | "medium" | "high";

/**
 * App-wide settings, held in the registry Durable Object's `config` table: tuning
 * (settings page) plus capability switches and their credentials (capabilities page).
 * The 0/1 fields are booleans; SQLite has no boolean type.
 *
 * Secrets read back as `SECRET_MASK`, never as the key itself. Sending the mask back
 * in a PATCH means "leave that key as it is".
 */
export type Config = {
  model: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  reasoning_effort: ReasoningEffort;
  context_messages: number;
  auto_title: number;

  cap_web_search: number;
  cap_url_fetch: number;
  cap_file_ingest: number;
  cap_vision: number;
  cap_image_generation: number;
  cap_audio_input: number;
  cap_scheduled_tasks: number;
  cap_memory: number;

  brave_api_key: string;
  image_model: string;
  transcription_model: string;
};

export const SECRET_MASK = "••••••••";

/** Capability metadata, defined once in the Worker and shipped to the browser. */
export type CapabilityField = {
  key: keyof Config;
  label: string;
  hint: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  /** When present the field is a fixed choice, not free text. */
  options?: { value: string; label: string }[];
};

export type Capability = {
  id: string;
  flag: keyof Config;
  label: string;
  summary: string;
  note: string;
  tools: string[];
  fields: CapabilityField[];
};

/** A capability is only usable once it is on *and* its required fields are filled. */
export function capabilityReady(
  capability: Capability,
  config: Config,
): boolean {
  if (!config[capability.flag]) return false;
  return capability.fields.every(
    (f) => !f.required || String(config[f.key] ?? "").trim() !== "",
  );
}

/** A file the user attached, or an image the agent drew, minus the bytes. */
export type Attachment = {
  id: string;
  kind: "text" | "image";
  name: string;
  mime: string;
  bytes: number;
  chars: number;
  /** First stretch of a text file, or of a voice note's transcript. */
  preview?: string;
};

export type ScheduledTask = { id: string; prompt: string; when: string };

export type Summary = {
  session: string;
  messages: number;
  llm: {
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
  };
  tasks: ScheduledTask[];
  sqlite_bytes: number;
};

export function agentUrl(sessionId: string, path: string) {
  return `${AGENT_URL}/agents/session-agent/${encodeURIComponent(sessionId)}/${path}`;
}
