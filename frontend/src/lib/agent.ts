/** Server-side access to the Cloudflare Worker that hosts the agent. */
export const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8787";

export type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  object_id: string;
  /** "web", or "telegram" for a chat the bot is in. */
  source?: string;
  /** The Telegram chat id behind a telegram session. */
  chat_id?: string;
  /** private, group, supergroup or channel. */
  chat_type?: string;
  /** A public chat's @handle, without the @. */
  chat_username?: string;
  /** The forum topic inside that chat, when the session is one topic of a group. */
  chat_thread_id?: string;
};

/**
 * Where "Continue in Telegram" points. Telegram has a link for every chat, but a
 * different one per kind:
 *
 * - A public group or channel is reachable by its @handle.
 * - A private supergroup is reachable at `t.me/c/<id>/1`, where the id is the chat id
 *   with Telegram's `-100` prefix stripped. It only opens for people already in it,
 *   which is exactly right: it is a link back to a conversation, not an invite.
 * - A forum topic hangs off its group's link, as `<group>/<topic id>`.
 * - A DM with the bot is the bot's own handle.
 */
export function telegramLink(session: SessionRow, botUsername: string): string {
  const topic = session.chat_thread_id ?? "";
  if (session.chat_username) {
    const group = `https://t.me/${session.chat_username}`;
    return topic ? `${group}/${topic}` : group;
  }
  const id = session.chat_id ?? "";
  // The trailing segment is the topic in a forum, and the first message otherwise.
  if (id.startsWith("-100")) return `https://t.me/c/${id.slice(4)}/${topic || "1"}`;
  // A basic group (not a supergroup) has no link of its own; the bot is the way in.
  return botUsername ? `https://t.me/${botUsername}` : "https://t.me";
}

export type StoredMessage = {
  /** The session-tree message id: a UUID, not a row number. */
  id: string;
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

  cap_web_search: number;
  cap_url_fetch: number;
  cap_file_ingest: number;
  cap_vision: number;
  cap_image_generation: number;
  cap_audio_input: number;
  cap_scheduled_tasks: number;
  cap_memory: number;
  cap_telegram: number;
  cap_mcp: number;

  brave_api_key: string;
  telegram_bot_token: string;
  telegram_bot_username: string;
  telegram_user_whitelist: string;
  telegram_group_whitelist: string;
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
  /** The field holds a list, one entry per line, edited as chips. */
  list?: boolean;
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

/* --------------------------------------------------------- mcp servers -- */

/** How an external MCP server authenticates this agent. */
export type McpAuth = "none" | "headers" | "oauth";

/** One tool an MCP server advertises. */
export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

/**
 * An external MCP server as the Worker hands it back. Header values, access tokens
 * and refresh tokens are never included: only the header *names*, so a saved key
 * shows as set without being sent to the browser.
 */
export type McpServer = {
  id: string;
  name: string;
  url: string;
  auth: McpAuth;
  enabled: number;
  header_names: string[];
  tools: McpTool[];
  /** False only for an OAuth server nobody has approved yet. */
  connected: boolean;
  tools_synced_at: number;
  /** Why the last tool sync failed. Empty when it worked. */
  last_error: string;
  oauth_scope: string;
  created_at: number;
};

/** A file the user attached, or an image the agent drew, minus the bytes. */
export type Attachment = {
  id: string;
  kind: "text" | "image" | "pdf";
  name: string;
  mime: string;
  bytes: number;
  chars: number;
  /** First stretch of a text file, or of a voice note's transcript. */
  preview?: string;
  /** Whether a render of a PDF's first page exists to draw on its card. */
  thumb?: boolean;
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
