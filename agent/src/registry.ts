import { DurableObject } from "cloudflare:workers";
import { McpTokenError, refreshToken, type McpServerRow } from "./mcp";

/**
 * One agent's settings, split in two:
 *
 * - Tuning (model, prompt, temperature…): how the agent talks.
 * - Capabilities (`cap_*` plus the credentials they need): what the agent can *do* —
 *   search, read files, see images, draw, hear, schedule work, remember.
 *
 * Every agent has its own `SessionRegistry`, so this row — bot token, MCP servers,
 * OpenRouter key and all — belongs to that agent alone. Nothing here is shared.
 *
 * One typed column per setting, in a single-row table: settings keep growing, and
 * columns keep them queryable and migratable instead of turning into one opaque blob.
 * Integers stand in for booleans because SQLite has no boolean type.
 *
 * API keys are stored here in plain text. That is deliberate for now — see README.
 */
export type Config = {
  model: string;
  /**
   * The agent's name, mirrored from the directory row so the model can be told what
   * it is called without the session object having to look the agent up.
   */
  agent_name: string;
  /** Appended to the built-in system prompt. Empty means "no custom instructions". */
  system_prompt: string;
  temperature: number;
  /** Cap on a single reply. 0 means "no cap: let the model stop on its own". */
  max_tokens: number;
  /** OpenRouter reasoning effort. "off" sends no reasoning field at all. */
  reasoning_effort: "off" | "low" | "medium" | "high";
  /** How many past messages to resend. 0 means "the whole transcript". */
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

  /**
   * The agent's own OpenRouter key. Every model call this agent makes is billed to
   * it, so one agent's spend and rate limits are its own. Blank falls back to the
   * Worker's `OPENROUTER_API_KEY`, which is what a single-agent deploy uses.
   */
  openrouter_api_key: string;
  /** Brave Search API key. The default web search provider when set. */
  brave_api_key: string;
  /** Base URL of a self-hosted SearXNG instance. Only used when `brave_api_key` is empty. */
  searxng_url: string;
  /** Bearer token for a guarded SearXNG instance. Blank when the instance is open. */
  searxng_token: string;
  /** OpenRouter model used for `generate_image`; billed on the existing OpenRouter key. */
  image_model: string;
  /** OpenRouter model used to transcribe audio uploads; same key, same bill. */
  transcription_model: string;
  /** Bot token from @BotFather. The bot is the agent's face on Telegram. */
  telegram_bot_token: string;
  /** The bot's @handle, without the @: a chat needs it to link back to the bot. */
  telegram_bot_username: string;
  /**
   * Who may talk to the bot in a DM: newline-separated usernames, or `/regex/`
   * entries. Empty means anyone.
   */
  telegram_user_whitelist: string;
  /**
   * Which groups the bot answers in: newline-separated chat ids, `chatId:topicId`
   * for one forum topic, or `/regex/` entries. Empty means any group.
   */
  telegram_group_whitelist: string;
};

export const DEFAULT_CONFIG: Omit<Config, "model"> = {
  agent_name: "",
  system_prompt: "",
  temperature: 0.7,
  max_tokens: 0,
  reasoning_effort: "off",
  context_messages: 0,

  cap_web_search: 0,
  cap_url_fetch: 0,
  cap_file_ingest: 0,
  cap_vision: 0,
  cap_image_generation: 0,
  cap_audio_input: 0,
  cap_scheduled_tasks: 0,
  cap_memory: 0,
  // On from the start: Telegram is how most agents are actually talked to, and the
  // switch does nothing until a bot token is pasted anyway.
  cap_telegram: 1,
  // On from the start: an MCP server is only reachable once it has been added and
  // connected, so the switch guards nothing the servers do not already guard.
  cap_mcp: 1,

  openrouter_api_key: "",
  brave_api_key: "",
  searxng_url: "",
  searxng_token: "",
  image_model: "google/gemini-2.5-flash-image",
  transcription_model: "google/gemini-2.5-flash-lite",
  telegram_bot_token: "",
  telegram_bot_username: "",
  telegram_user_whitelist: "",
  telegram_group_whitelist: "",
};

/**
 * Meta settings: an agent's settings *about* its settings.
 *
 * Where `Config` is what the agent is set to right now, this is what it should be
 * set to by default — which model choices it is offered at all, which capabilities
 * arrive switched on, what their fields start out holding, and which MCP templates
 * and servers belong to it. Applying it writes those defaults into `Config`; nothing
 * here is read on a turn, so a turn's behaviour still comes from `Config` alone.
 *
 * One JSON blob rather than columns: it is nested (per capability, per server) and
 * nothing queries it, so columns would buy nothing and cost a migration per field.
 */
export type MetaSettings = {
  /**
   * The models the settings page may offer, typed in rather than picked: OpenRouter's
   * catalogue is far larger than the handful a deployment names in `MODELS`, and an
   * agent that wants one of the others should not need a release. Empty means the
   * deployment's own list.
   *
   * Each carries its own `vision`, because an id typed in is one nothing else knows
   * anything about — whether it can be sent an image is a thing only the person
   * adding it can say.
   */
  models: ModelChoice[];
  /** Default tuning values. A key that is absent keeps the factory default. */
  defaults: Partial<Pick<Config, MetaTunableKey>>;
  /**
   * Settings the agent's own pages may not touch: capability ids and config columns.
   * A locked setting is not shown under the agent at all — it is decided here and
   * nowhere else, which is what makes this more than a set of starting values.
   */
  locked: string[];
  /** Per capability: whether it starts on, and what its fields start out holding. */
  capabilities: Record<string, MetaCapability>;
  /**
   * Open lists of what a fixed-choice field may be set to, by config column — the
   * image model and the transcription model. Same reasoning as `models`: the built-in
   * choices are a starting point, not the limit. An absent or empty list leaves the
   * field offering what the Worker ships.
   */
  field_options: Record<string, string[]>;
  mcp: {
    /** Preset ids offered on the capabilities page. Empty means every preset. */
    templates: string[];
    /** Servers added to the agent when the defaults are applied, matched by name. */
    servers: MetaMcpServer[];
    /**
     * Whether the agent's own pages may add servers of their own — and rename, repoint
     * or remove the ones it has.
     *
     * On is the open arrangement: the servers above are a starting point and the agent
     * builds out the rest. Off makes the list this dialog's alone, which is what an
     * agent handed to somebody else wants — they can switch a server off, pick which
     * of its tools it may call and approve its OAuth, because that is using what they
     * were given, but the list itself is not theirs to change.
     */
    user_servers: boolean;
  };
};

/**
 * One model an agent may be switched to: an OpenRouter id, and whether it sees images.
 * No label — a model that is in the deployment's catalogue is shown under the name
 * that gives it, and one that is not is shown as the id it is.
 */
export type ModelChoice = { id: string; vision: boolean };

/** The tuning settings a default may be given for. */
export type MetaTunableKey =
  | "model"
  | "system_prompt"
  | "temperature"
  | "max_tokens"
  | "reasoning_effort"
  | "context_messages"
  | "openrouter_api_key";

export type MetaCapability = {
  /** Whether the capability is switched on when the defaults are applied. */
  enabled?: boolean;
  /** Default values for that capability's fields, by config column. */
  fields?: Record<string, string>;
};

/**
 * One MCP server the agent should have. OAuth still has to be approved per server —
 * this only gets the row in place, with the headers it needs, so connecting is a
 * click rather than a re-entry of the URL.
 */
export type MetaMcpServer = {
  name: string;
  url: string;
  auth: "none" | "headers" | "oauth";
  /** Default headers, by name. Sent as-is to a `headers` server. */
  headers: Record<string, string>;
};

export const DEFAULT_META: MetaSettings = {
  models: [],
  defaults: {},
  locked: [],
  capabilities: {},
  field_options: {},
  mcp: { templates: [], servers: [], user_servers: true },
};

/** The config columns, in the order they are written, excluding the primary key. */
const CONFIG_COLUMNS = ["model", ...Object.keys(DEFAULT_CONFIG)] as (keyof Config)[];

/** `ALTER TABLE` fragments for every column added after `config` first shipped. */
const CONFIG_MIGRATIONS = [
  `system_prompt TEXT NOT NULL DEFAULT ''`,
  `agent_name TEXT NOT NULL DEFAULT ''`,
  `temperature REAL NOT NULL DEFAULT 0.7`,
  `max_tokens INTEGER NOT NULL DEFAULT 0`,
  `reasoning_effort TEXT NOT NULL DEFAULT 'off'`,
  `context_messages INTEGER NOT NULL DEFAULT 0`,
  `cap_web_search INTEGER NOT NULL DEFAULT 0`,
  `cap_url_fetch INTEGER NOT NULL DEFAULT 0`,
  `cap_file_ingest INTEGER NOT NULL DEFAULT 0`,
  `cap_vision INTEGER NOT NULL DEFAULT 0`,
  `cap_image_generation INTEGER NOT NULL DEFAULT 0`,
  `cap_audio_input INTEGER NOT NULL DEFAULT 0`,
  `cap_scheduled_tasks INTEGER NOT NULL DEFAULT 0`,
  `cap_memory INTEGER NOT NULL DEFAULT 0`,
  `cap_telegram INTEGER NOT NULL DEFAULT 0`,
  `brave_api_key TEXT NOT NULL DEFAULT ''`,
  `image_model TEXT NOT NULL DEFAULT '${DEFAULT_CONFIG.image_model}'`,
  `transcription_model TEXT NOT NULL DEFAULT '${DEFAULT_CONFIG.transcription_model}'`,
  `telegram_bot_token TEXT NOT NULL DEFAULT ''`,
  `telegram_bot_username TEXT NOT NULL DEFAULT ''`,
  `telegram_user_whitelist TEXT NOT NULL DEFAULT ''`,
  `telegram_group_whitelist TEXT NOT NULL DEFAULT ''`,
  `cap_mcp INTEGER NOT NULL DEFAULT 1`,
  `searxng_url TEXT NOT NULL DEFAULT ''`,
  `searxng_token TEXT NOT NULL DEFAULT ''`,
  `openrouter_api_key TEXT NOT NULL DEFAULT ''`,
];

/** The `mcp_servers` columns, in write order, excluding the primary key. */
const MCP_COLUMNS = [
  "name",
  "url",
  "auth",
  "headers",
  "enabled",
  "oauth_client_id",
  "oauth_client_secret",
  "oauth_access_token",
  "oauth_refresh_token",
  "oauth_expires_at",
  "oauth_scope",
  "oauth_token_url",
  "oauth_authorize_url",
  "oauth_registration_url",
  "oauth_resource",
  "oauth_verifier",
  "oauth_state",
  "oauth_return_to",
  "tools_json",
  "disabled_tools",
  "tools_synced_at",
  "last_error",
  "created_at",
] as const;

/** A server the user has not filled in yet: every column with nothing in it. */
export const EMPTY_MCP_SERVER: Omit<McpServerRow, "id" | "name" | "url" | "created_at"> = {
  auth: "none",
  headers: "",
  enabled: 1,
  oauth_client_id: "",
  oauth_client_secret: "",
  oauth_access_token: "",
  oauth_refresh_token: "",
  oauth_expires_at: 0,
  oauth_scope: "",
  oauth_token_url: "",
  oauth_authorize_url: "",
  oauth_registration_url: "",
  oauth_resource: "",
  oauth_verifier: "",
  oauth_state: "",
  oauth_return_to: "",
  tools_json: "",
  disabled_tools: "",
  tools_synced_at: 0,
  last_error: "",
};

/** A fact the agent chose to keep. Memories span an agent, not one session. */
export type Memory = {
  id: number;
  text: string;
  session_id: string;
  created_at: number;
};

export type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  /**
   * Hex id of this session's Durable Object. Nothing in the app reads it; it is kept
   * because it is the `objectId` needed to query Cloudflare's usage analytics by hand.
   */
  object_id: string;
  /** "web" for a session started in the browser, "telegram" for a chat with the bot. */
  source: string;
  /** The Telegram chat this session belongs to. Empty for a browser session. */
  chat_id: string;
  /** Telegram's own chat type: private, group, supergroup, channel. */
  chat_type: string;
  /** A public chat's @handle, without the @. Empty for a private one. */
  chat_username: string;
  /**
   * The forum topic inside that chat, as a string, or empty when the session is the
   * whole chat. A forum gets one session per topic, so this is part of what makes a
   * conversation distinct.
   */
  chat_thread_id: string;
};

/**
 * A single Durable Object holding the list of sessions.
 *
 * Durable Object namespaces are not enumerable — you can address an instance by name,
 * but you cannot ask Cloudflare "which instances exist". So the index lives here, in
 * one well-known object, while each session's data lives in its own SessionAgent.
 */
/**
 * Session ids carry the agent that owns them, as `<agentId>~<local>`.
 *
 * `SessionAgent` is one Durable Object namespace for the whole Worker, so a session
 * id has to be unique across every agent — and the ids that are not random are the
 * ones that would collide: two agents in the same Telegram chat both want `tg-123`,
 * which would be the same object. The prefix is also how a session finds its agent:
 * a `SessionAgent` knows nothing but its own name, and reads the owner back out of it.
 */
export const AGENT_SEPARATOR = "~";

/** The full session id for a session local to `agentId`. */
export function sessionName(agentId: string, local: string): string {
  return `${agentId}${AGENT_SEPARATOR}${local}`;
}

/** The agent a session id belongs to. Empty when the id is not one of ours. */
export function agentIdOf(sessionId: string): string {
  const cut = sessionId.indexOf(AGENT_SEPARATOR);
  return cut === -1 ? "" : sessionId.slice(0, cut);
}

/**
 * The session a Telegram conversation maps to. A DM is one chat, a group is another,
 * and a forum topic is its own conversation inside a group — so this is what gives
 * each of them its own session, and keeps giving it the same one. Two agents are two
 * different bots, so the same chat under each of them is two separate sessions.
 */
export function sessionIdForChat(agentId: string, chatId: string, threadId = ""): string {
  const base = `tg-${chatId.replace("-", "n")}`;
  return sessionName(agentId, threadId ? `${base}-t${threadId}` : base);
}

/** Sessions per page when the caller does not ask for a size. */
export const SESSION_PAGE = 30;
/** The largest page any caller may ask for, sessions or messages alike. */
export const MAX_PAGE = 200;

/** One page of the session list, plus the cursor that continues it. */
export type SessionPage = {
  sessions: SessionRow[];
  has_more: boolean;
  /** Pass back as `cursor` for the next page. Empty when the list is exhausted. */
  cursor: string;
};

/** A `<updated_at>:<id>` cursor, or undefined when there is none to resume from. */
function parseCursor(cursor: string): { updated_at: number; id: string } | undefined {
  if (!cursor) return undefined;
  const cut = cursor.indexOf(":");
  if (cut === -1) return undefined;
  const updated_at = Number(cursor.slice(0, cut));
  const id = cursor.slice(cut + 1);
  if (!Number.isFinite(updated_at) || !id) return undefined;
  return { updated_at, id };
}

export class SessionRegistry extends DurableObject {
  private ready = false;
  /** Token refreshes in flight, by server id, so concurrent callers share one. */
  private refreshing = new Map<string, Promise<McpServerRow | undefined>>();

  private ensureSchema() {
    if (this.ready) return;
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         object_id TEXT NOT NULL DEFAULT '',
         source TEXT NOT NULL DEFAULT 'web',
         chat_id TEXT NOT NULL DEFAULT '',
         chat_type TEXT NOT NULL DEFAULT '',
         chat_username TEXT NOT NULL DEFAULT '',
         chat_thread_id TEXT NOT NULL DEFAULT ''
       )`
    );
    for (const col of [
      `object_id TEXT NOT NULL DEFAULT ''`,
      `source TEXT NOT NULL DEFAULT 'web'`,
      `chat_id TEXT NOT NULL DEFAULT ''`,
      `chat_type TEXT NOT NULL DEFAULT ''`,
      `chat_username TEXT NOT NULL DEFAULT ''`,
      `chat_thread_id TEXT NOT NULL DEFAULT ''`,
    ]) {
      try {
        this.ctx.storage.sql.exec(`ALTER TABLE sessions ADD COLUMN ${col}`);
      } catch {
        // Column already present.
      }
    }
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS config (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         model TEXT NOT NULL
       )`
    );
    // Bring forward config rows created before the tuning and capability columns.
    for (const col of CONFIG_MIGRATIONS) {
      try {
        this.ctx.storage.sql.exec(`ALTER TABLE config ADD COLUMN ${col}`);
      } catch {
        // Column already present.
      }
    }
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS meta (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         json TEXT NOT NULL DEFAULT ''
       )`
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS memories (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         text TEXT NOT NULL,
         session_id TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS mcp_servers (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         url TEXT NOT NULL,
         auth TEXT NOT NULL DEFAULT 'none',
         headers TEXT NOT NULL DEFAULT '',
         enabled INTEGER NOT NULL DEFAULT 1,
         oauth_client_id TEXT NOT NULL DEFAULT '',
         oauth_client_secret TEXT NOT NULL DEFAULT '',
         oauth_access_token TEXT NOT NULL DEFAULT '',
         oauth_refresh_token TEXT NOT NULL DEFAULT '',
         oauth_expires_at INTEGER NOT NULL DEFAULT 0,
         oauth_scope TEXT NOT NULL DEFAULT '',
         oauth_token_url TEXT NOT NULL DEFAULT '',
         oauth_authorize_url TEXT NOT NULL DEFAULT '',
         oauth_registration_url TEXT NOT NULL DEFAULT '',
         oauth_resource TEXT NOT NULL DEFAULT '',
         oauth_verifier TEXT NOT NULL DEFAULT '',
         oauth_state TEXT NOT NULL DEFAULT '',
         oauth_return_to TEXT NOT NULL DEFAULT '',
         tools_json TEXT NOT NULL DEFAULT '',
         disabled_tools TEXT NOT NULL DEFAULT '',
         tools_synced_at INTEGER NOT NULL DEFAULT 0,
         last_error TEXT NOT NULL DEFAULT '',
         created_at INTEGER NOT NULL DEFAULT 0
       )`
    );
    // Bring forward server rows created before a column was added.
    for (const col of [`disabled_tools TEXT NOT NULL DEFAULT ''`]) {
      try {
        this.ctx.storage.sql.exec(`ALTER TABLE mcp_servers ADD COLUMN ${col}`);
      } catch {
        // Column already present.
      }
    }
    this.ready = true;
  }

  /* --------------------------------------------------------- mcp servers -- */

  /**
   * The external MCP servers, oldest first, credentials and all. Only the Worker
   * calls this: `server.ts` strips the secrets before anything reaches the browser.
   */
  mcpServers(): McpServerRow[] {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec(`SELECT id, ${MCP_COLUMNS.join(", ")} FROM mcp_servers ORDER BY created_at`)
      .toArray() as unknown as McpServerRow[];
  }

  mcpServer(id: string): McpServerRow | undefined {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec(`SELECT id, ${MCP_COLUMNS.join(", ")} FROM mcp_servers WHERE id = ? LIMIT 1`, id)
      .toArray()[0] as unknown as McpServerRow | undefined;
  }

  /** The server an in-flight OAuth callback belongs to, matched on its CSRF state. */
  mcpServerByState(state: string): McpServerRow | undefined {
    this.ensureSchema();
    if (!state) return undefined;
    return this.ctx.storage.sql
      .exec(
        `SELECT id, ${MCP_COLUMNS.join(", ")} FROM mcp_servers WHERE oauth_state = ? LIMIT 1`,
        state
      )
      .toArray()[0] as unknown as McpServerRow | undefined;
  }

  addMcpServer(row: McpServerRow): McpServerRow {
    this.ensureSchema();
    const placeholders = MCP_COLUMNS.map(() => "?").join(", ");
    this.ctx.storage.sql.exec(
      `INSERT INTO mcp_servers (id, ${MCP_COLUMNS.join(", ")}) VALUES (?, ${placeholders})`,
      row.id,
      ...MCP_COLUMNS.map((c) => row[c])
    );
    return row;
  }

  /** A partial update: only the columns present are written. */
  updateMcpServer(id: string, patch: Partial<McpServerRow>): McpServerRow | undefined {
    this.ensureSchema();
    const keys = MCP_COLUMNS.filter((c) => patch[c] !== undefined);
    if (keys.length > 0) {
      this.ctx.storage.sql.exec(
        `UPDATE mcp_servers SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
        ...keys.map((k) => patch[k] as string | number),
        id
      );
    }
    return this.mcpServer(id);
  }

  /**
   * The access token for a server, refreshed if it is spent.
   *
   * Refreshing lives here, in the one object that owns the row, because a turn can
   * call several of a server's tools at once and a provider that rotates refresh
   * tokens only honours the first of two concurrent refreshes. In-flight refreshes
   * are shared, so those callers wait on one request and all see the same result.
   *
   * `force` is for a call that has already been answered with a 401: the stored
   * expiry said the token was good, and the provider disagrees.
   */
  async refreshMcpToken(id: string, force = false): Promise<McpServerRow | undefined> {
    const server = this.mcpServer(id);
    if (!server || server.auth !== "oauth" || !server.oauth_refresh_token) return server;

    const spent = server.oauth_expires_at > 0 && server.oauth_expires_at - Date.now() < 60_000;
    if (!force && !spent) return server;

    const existing = this.refreshing.get(id);
    if (existing) return await existing;

    const attempt = this.performRefresh(server).finally(() => this.refreshing.delete(id));
    this.refreshing.set(id, attempt);
    return await attempt;
  }

  private async performRefresh(server: McpServerRow): Promise<McpServerRow | undefined> {
    try {
      const tokens = await refreshToken(server.oauth_token_url, {
        refreshToken: server.oauth_refresh_token,
        clientId: server.oauth_client_id,
        clientSecret: server.oauth_client_secret || undefined,
        resource: server.oauth_resource || undefined,
      });
      return this.updateMcpServer(server.id, {
        oauth_access_token: tokens.access_token,
        // A provider that rotates hands back a new one; keep the old when it does not.
        oauth_refresh_token: tokens.refresh_token ?? server.oauth_refresh_token,
        oauth_expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : 0,
        last_error: "",
      });
    } catch (err) {
      // A refusal of the grant itself is the end of this connection: drop the tokens
      // so the server reads as disconnected and offers a Connect button, rather than
      // sitting there advertising tools that every call will fail.
      if (err instanceof McpTokenError && err.permanent) {
        return this.updateMcpServer(server.id, {
          oauth_access_token: "",
          oauth_refresh_token: "",
          oauth_expires_at: 0,
          tools_json: "",
          last_error: "The connection expired. Connect again to keep using it.",
        });
      }
      return this.updateMcpServer(server.id, {
        last_error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Notes what a failed call learned, so the card stops claiming the server works. */
  noteMcpError(id: string, message: string) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`UPDATE mcp_servers SET last_error = ? WHERE id = ?`, message, id);
  }

  removeMcpServer(id: string) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`DELETE FROM mcp_servers WHERE id = ?`, id);
  }

  /* ------------------------------------------------------- meta settings -- */

  /** The agent's defaults, or the empty set when nobody has set any. */
  meta(): MetaSettings {
    this.ensureSchema();
    const row = this.ctx.storage.sql.exec(`SELECT json FROM meta WHERE id = 1`).toArray()[0] as
      | { json: string }
      | undefined;
    if (!row?.json) return DEFAULT_META;
    try {
      const stored = JSON.parse(row.json) as Partial<MetaSettings>;
      return {
        ...DEFAULT_META,
        ...stored,
        // The list was bare ids before each model carried its own vision flag. An
        // agent stored back then said nothing about images either way, which is the
        // same thing an unknown id says: assume it sees them.
        models: (stored.models ?? []).map((m) =>
          typeof m === "string" ? { id: m, vision: true } : m
        ),
        mcp: { ...DEFAULT_META.mcp, ...(stored.mcp ?? {}) },
      };
    } catch {
      // A blob we cannot read is one nobody can fix from the dialog either.
      return DEFAULT_META;
    }
  }

  /** Replaces the whole document: the dialog always sends the settings entire. */
  setMeta(next: MetaSettings): MetaSettings {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `INSERT INTO meta (id, json) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
      JSON.stringify(next)
    );
    return this.meta();
  }

  /** Reads the settings row, seeding it from the Worker default on first use. */
  config(defaultModel: string): Config {
    this.ensureSchema();
    const row = this.ctx.storage.sql
      .exec(`SELECT ${CONFIG_COLUMNS.join(", ")} FROM config WHERE id = 1`)
      .toArray()[0] as Config | undefined;
    if (row) return row;
    const seeded: Config = { model: defaultModel, ...DEFAULT_CONFIG };
    this.write(seeded);
    return seeded;
  }

  setConfig(patch: Partial<Config>, defaultModel: string): Config {
    const next = { ...this.config(defaultModel), ...patch };
    this.write(next);
    return next;
  }

  private write(config: Config) {
    const placeholders = CONFIG_COLUMNS.map(() => "?").join(", ");
    const updates = CONFIG_COLUMNS.map((c) => `${c} = excluded.${c}`).join(", ");
    this.ctx.storage.sql.exec(
      `INSERT INTO config (id, ${CONFIG_COLUMNS.join(", ")}) VALUES (1, ${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updates}`,
      ...CONFIG_COLUMNS.map((c) => config[c])
    );
  }

  /**
   * One page of sessions, newest first.
   *
   * The list is read on every page load and after every turn, and a busy agent
   * accumulates sessions without bound — so it is paged rather than returned whole.
   * `cursor` is keyset rather than an offset: sessions are ordered by `updated_at`,
   * which a turn changes underneath a scroll, and an offset would skip or repeat
   * rows when that happens. `id` breaks ties between sessions touched in the same
   * millisecond, and is what makes the cursor a total order.
   */
  list(limit = SESSION_PAGE, cursor = ""): SessionPage {
    this.ensureSchema();
    const size = Math.max(1, Math.min(limit, MAX_PAGE));
    const after = parseCursor(cursor);
    // One row past the page: its existence is the only thing `has_more` needs, and
    // it is cheaper than a second COUNT over the table.
    const rows = (
      after
        ? this.ctx.storage.sql.exec(
            `SELECT id, title, created_at, updated_at, object_id, source, chat_id, chat_type,
                    chat_username, chat_thread_id
             FROM sessions
             WHERE updated_at < ? OR (updated_at = ? AND id > ?)
             ORDER BY updated_at DESC, id ASC LIMIT ?`,
            after.updated_at,
            after.updated_at,
            after.id,
            size + 1
          )
        : this.ctx.storage.sql.exec(
            `SELECT id, title, created_at, updated_at, object_id, source, chat_id, chat_type,
                    chat_username, chat_thread_id
             FROM sessions ORDER BY updated_at DESC, id ASC LIMIT ?`,
            size + 1
          )
    ).toArray() as unknown as SessionRow[];

    const page = rows.slice(0, size);
    const last = page[page.length - 1];
    return {
      sessions: page,
      has_more: rows.length > size,
      cursor: rows.length > size && last ? `${last.updated_at}:${last.id}` : "",
    };
  }

  create(
    id: string,
    title: string,
    objectId: string,
    origin: Pick<
      SessionRow,
      "source" | "chat_id" | "chat_type" | "chat_username" | "chat_thread_id"
    > = {
      source: "web",
      chat_id: "",
      chat_type: "",
      chat_username: "",
      chat_thread_id: "",
    }
  ): SessionRow {
    this.ensureSchema();
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions (id, title, created_at, updated_at, object_id, source, chat_id,
                             chat_type, chat_username, chat_thread_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at,
                                     object_id = excluded.object_id`,
      id,
      title,
      now,
      now,
      objectId,
      origin.source,
      origin.chat_id,
      origin.chat_type,
      origin.chat_username,
      origin.chat_thread_id
    );
    return { id, title, created_at: now, updated_at: now, object_id: objectId, ...origin };
  }

  /**
   * The session a Telegram conversation maps to, if it has one already. A topic is its
   * own conversation, so the thread is matched too — a group's own session (thread '')
   * never answers for a topic inside it.
   */
  forChat(chatId: string, threadId = ""): SessionRow | undefined {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec(
        `SELECT id, title, created_at, updated_at, object_id, source, chat_id, chat_type,
                chat_username, chat_thread_id
         FROM sessions WHERE chat_id = ? AND chat_thread_id = ? LIMIT 1`,
        chatId,
        threadId
      )
      .toArray()[0] as unknown as SessionRow | undefined;
  }

  /**
   * A session id for a chat that has none yet. Normally that is the chat's own id,
   * but `!new` leaves the previous session in place under exactly that name — so a
   * generation is appended until the name is free. Without this the "new" session
   * would be the old Durable Object again, which is the one thing it must not be.
   *
   * It lives here rather than at the webhook because `!new` needs the same answer:
   * the session it hands its scheduled tasks to has to be the one the next message
   * lands in.
   */
  freeChatSessionId(agentId: string, chatId: string, threadId = ""): string {
    this.ensureSchema();
    const base = sessionIdForChat(agentId, chatId, threadId);
    if (!this.get(base)) return base;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base}-g${n}`;
      if (!this.get(candidate)) return candidate;
    }
    // A thousand fresh starts in one chat is not a thing; fall back to a unique name.
    return `${base}-g${crypto.randomUUID().slice(0, 8)}`;
  }

  /** One session by id, or nothing. */
  get(id: string): SessionRow | undefined {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec(
        `SELECT id, title, created_at, updated_at, object_id, source, chat_id, chat_type,
                chat_username, chat_thread_id
         FROM sessions WHERE id = ? LIMIT 1`,
        id
      )
      .toArray()[0] as unknown as SessionRow | undefined;
  }

  /**
   * Cut a session loose from its Telegram chat without touching what it holds. The
   * chat stops resolving to it, so the next message there starts somewhere new, while
   * the conversation stays readable in the browser exactly as it was left.
   */
  detachChat(id: string) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE sessions SET chat_id = '', chat_thread_id = '' WHERE id = ?`,
      id
    );
  }

  touch(id: string) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`UPDATE sessions SET updated_at = ? WHERE id = ?`, Date.now(), id);
  }

  rename(id: string, title: string) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`UPDATE sessions SET title = ? WHERE id = ?`, title, id);
  }

  remove(id: string) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`DELETE FROM sessions WHERE id = ?`, id);
  }

  /**
   * Memory spans the agent on purpose: a fact worth keeping ("I use pnpm") is worth
   * keeping in the agent's next session too, which is the whole point of remembering
   * it. It stops there — one agent never reads another's memories.
   */
  remember(text: string, sessionId: string): Memory {
    this.ensureSchema();
    const row = { text, session_id: sessionId, created_at: Date.now() };
    const id = this.ctx.storage.sql
      .exec(
        `INSERT INTO memories (text, session_id, created_at) VALUES (?, ?, ?) RETURNING id`,
        row.text,
        row.session_id,
        row.created_at
      )
      .toArray()[0] as { id: number };
    return { id: id.id, ...row };
  }

  /**
   * Substring search, newest first. Small enough a table that scanning it beats
   * carrying an embedding model around; `query` empty returns the most recent.
   */
  recall(query: string, limit = 20): Memory[] {
    this.ensureSchema();
    const sql = query
      ? `SELECT id, text, session_id, created_at FROM memories
         WHERE text LIKE ? COLLATE NOCASE ORDER BY id DESC LIMIT ?`
      : `SELECT id, text, session_id, created_at FROM memories ORDER BY id DESC LIMIT ?`;
    const args = query ? [`%${query}%`, limit] : [limit];
    return this.ctx.storage.sql.exec(sql, ...args).toArray() as unknown as Memory[];
  }

  forget(id: number) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`DELETE FROM memories WHERE id = ?`, id);
  }

  /**
   * Drop everything this agent owns. Called when the agent itself is deleted, after
   * its sessions have been destroyed: a Durable Object is billed for the bytes it
   * holds, so an emptied-but-living registry still costs.
   */
  async wipe(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.ready = false;
  }
}

/* ------------------------------------------------------------- directory -- */

/** An agent: a bot, its settings, its MCP servers, its memories, its sessions. */
export type AgentRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  /**
   * Who may open this agent: newline-separated email addresses, lowercased.
   *
   * Access is by email rather than by account id because an agent is usually shared
   * before the people it is shared with have signed in — the address is what the
   * owner knows, and Clerk hands the same address back once they do. Empty means
   * nobody but nothing else: an agent with no addresses is unreachable, which is why
   * creation always seeds it with the creator's own.
   */
  allowed_emails: string;
  /**
   * The one address that administers this agent: whoever created it, lowercased.
   *
   * Separate from `allowed_emails` on purpose. The access list says who may *use* the
   * agent — open its pages, chat with it, change its settings. This says who may
   * change the decisions *behind* those settings: the meta document, and whether the
   * agent goes on existing at all. It is set once, at creation, and never moves.
   *
   * Being the admin is not membership. An admin who is not on the access list cannot
   * open the agent any more than a stranger can; they see it on their list of agents
   * and they can administer it, and that is all. Putting themselves on the list is a
   * deliberate act, the same as adding anybody else.
   */
  admin_email: string;
};

/**
 * How many addresses one agent's access list may hold.
 *
 * A ceiling rather than a storage limit — membership is rows now, not one column, so
 * this is only about keeping a pasted mailing list from turning into ten thousand
 * inserts. Going over is an error, not a truncation: silently dropping the addresses
 * past the cap is how someone adds a teammate, sees the save succeed, and finds out
 * weeks later that the teammate was never on the list.
 */
export const MAX_MEMBERS = 200;

/** The addresses in a stored access list: lowercased, trimmed, blanks dropped. */
export function splitEmails(stored: string): string[] {
  return stored
    .split("\n")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The stored form of an access list: lowercased, de-duplicated, one per line.
 *
 * Throws when there are more than `MAX_MEMBERS` of them, so the caller can say so.
 */
export function normalizeEmails(input: string | string[]): string {
  const raw = Array.isArray(input) ? input : input.split(/[\n,;]/);
  const seen = new Set<string>();
  for (const entry of raw) {
    const email = entry.trim().toLowerCase();
    // Enough of a shape check to keep typos and pasted prose out of the list.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) seen.add(email);
  }
  if (seen.size > MAX_MEMBERS) {
    throw new Error(`an agent may have at most ${MAX_MEMBERS} addresses on its access list`);
  }
  return [...seen].join("\n");
}

/** The first address on a stored access list, or "" when it is empty. */
function firstEmail(allowed: string): string {
  return splitEmails(allowed)[0] ?? "";
}

/**
 * Whether `email` appears in a stored access list.
 *
 * Still here, and still exact, because the access list travels to the Worker as the
 * text column on `AgentRow` — `mayUseAgent` and the per-section checks in `server.ts`
 * have a row in hand and no reason to ask the directory a second question. The
 * `agent_members` table is what makes *finding* rows by address indexable; this is
 * what checks one row already fetched.
 */
export function emailAllowed(allowed: string, email: string): boolean {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return false;
  return splitEmails(allowed).includes(wanted);
}

/**
 * The list of agents, in one well-known Durable Object.
 *
 * Same reason the session index exists: a Durable Object namespace can be addressed
 * by name but not enumerated, so "which agents exist" has to be written down
 * somewhere. This holds names only — everything an agent *is* lives in its own
 * `SessionRegistry`, which is why deleting an agent is two steps, not one.
 */
export class AgentDirectory extends DurableObject {
  private ready = false;

  private ensureSchema() {
    if (this.ready) return;
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS agents (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         allowed_emails TEXT NOT NULL DEFAULT '',
         admin_email TEXT NOT NULL DEFAULT ''
       )`
    );
    // Bring forward rows created before an agent had an access list, and before the
    // admin was a person rather than everyone on that list.
    for (const col of [
      `allowed_emails TEXT NOT NULL DEFAULT ''`,
      `admin_email TEXT NOT NULL DEFAULT ''`,
    ]) {
      try {
        this.ctx.storage.sql.exec(`ALTER TABLE agents ADD COLUMN ${col}`);
      } catch {
        // Column already present.
      }
    }
    // Agents made before the split have no admin, and no record of who created them:
    // everyone on the list was both user and administrator. The first address on the
    // list is the closest thing to the creator that was ever written down — the
    // create dialog seeds the box with their own address — so it inherits the role.
    this.ctx.storage.sql.exec(
      `UPDATE agents
          SET admin_email = lower(trim(
                CASE WHEN instr(allowed_emails, char(10)) > 0
                     THEN substr(allowed_emails, 1, instr(allowed_emails, char(10)) - 1)
                     ELSE allowed_emails END))
        WHERE admin_email = ''`
    );

    // One row per address, which is what makes "the agents this person may open" an
    // index lookup instead of a walk over every agent in the deployment.
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS agent_members (
         agent_id TEXT NOT NULL,
         email TEXT NOT NULL,
         PRIMARY KEY (agent_id, email)
       )`
    );
    this.ctx.storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_members_email ON agent_members(email)`
    );
    this.ctx.storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_agents_admin_email ON agents(admin_email)`
    );

    this.migrate();
    this.ready = true;
  }

  /**
   * One-time data migrations, guarded by a version number rather than by the shape of
   * the data.
   *
   * The `admin_email` backfill above can re-run harmlessly because "no admin" is a
   * state the data can express. Membership cannot: an agent with no rows in
   * `agent_members` is indistinguishable from one that has not been migrated yet, and
   * guessing wrong in the second direction would silently re-add addresses that were
   * deliberately removed. So the version is written down.
   *
   * Nothing here drops anything. `agents.allowed_emails` stays exactly as it was —
   * see `setAllowedEmails` for why it is still written.
   */
  private migrate() {
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
    const current = Number(
      (sql.exec(`SELECT version FROM schema_version LIMIT 1`).toArray()[0]?.version as
        | number
        | undefined) ?? 0
    );

    // v1: membership moves from the newline-separated column to its own table. The
    // column is the only record of who was on which list, so it is read, not cleared.
    if (current < 1) {
      this.ctx.storage.transactionSync(() => {
        const rows = sql
          .exec(`SELECT id, allowed_emails FROM agents`)
          .toArray() as unknown as { id: string; allowed_emails: string }[];
        for (const row of rows) {
          for (const email of splitEmails(row.allowed_emails)) {
            sql.exec(
              `INSERT OR IGNORE INTO agent_members (agent_id, email) VALUES (?, ?)`,
              row.id,
              email
            );
          }
        }
        sql.exec(`DELETE FROM schema_version`);
        sql.exec(`INSERT INTO schema_version (version) VALUES (1)`);
      });
    }
  }

  /**
   * Point `agent_members` at exactly `emails`, and mirror the same list back into
   * `agents.allowed_emails`.
   *
   * Two places, one write, because they answer different questions. The table answers
   * "which agents may this address open", which has to be indexable. The column
   * answers "who is on this agent's list", which every read of a row already needs —
   * so keeping it means `get()` stays a single-row read with no join, and the shape
   * the Worker and the browser see does not change at all.
   *
   * It is a projection, not a second opinion: this is the only method that writes
   * either of them, and it writes both inside one transaction.
   */
  private writeMembers(id: string, allowedEmails: string) {
    const emails = splitEmails(allowedEmails);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`DELETE FROM agent_members WHERE agent_id = ?`, id);
      for (const email of emails) {
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO agent_members (agent_id, email) VALUES (?, ?)`,
          id,
          email
        );
      }
      this.ctx.storage.sql.exec(
        `UPDATE agents SET allowed_emails = ?, updated_at = ? WHERE id = ?`,
        emails.join("\n"),
        Date.now(),
        id
      );
    });
  }

  /**
   * Every agent, or — given an email — only the ones that address may open.
   *
   * Two ways onto the list, and both are an index lookup: the address administers the
   * agent, or it is one of the agent's members. An admin sees the agent they made
   * whether or not they are also on its access list — administering one you cannot
   * open is the ordinary case now that the two are separate.
   *
   * The match is exact on both sides. Addresses are stored already lowercased and
   * trimmed, by `normalizeEmails` on the way in, so there is nothing to normalize
   * here beyond the address being asked about.
   */
  list(email?: string): AgentRow[] {
    this.ensureSchema();
    if (email === undefined) {
      return this.ctx.storage.sql
        .exec(
          `SELECT id, name, created_at, updated_at, allowed_emails, admin_email FROM agents
           ORDER BY created_at`
        )
        .toArray() as unknown as AgentRow[];
    }
    const wanted = email.trim().toLowerCase();
    if (!wanted) return [];
    // A `UNION` of the two ways on, rather than one `WHERE x OR EXISTS (…)`.
    //
    // They return the same rows, but SQLite cannot use an index for an `OR` across
    // two tables — it falls back to scanning every agent and running the subquery per
    // row, which is the walk this table exists to remove. Split in two, each half is
    // an index lookup: `idx_agents_admin_email` for the left, `idx_agent_members_email`
    // for the right. `UNION` is the deduplicating one, which is what keeps an admin
    // who is also on the access list from appearing twice.
    return this.ctx.storage.sql
      .exec(
        `SELECT a.id, a.name, a.created_at, a.updated_at, a.allowed_emails, a.admin_email
           FROM agents a
          WHERE a.admin_email = ?1
          UNION
         SELECT a.id, a.name, a.created_at, a.updated_at, a.allowed_emails, a.admin_email
           FROM agents a
           JOIN agent_members m ON m.agent_id = a.id
          WHERE m.email = ?1
          ORDER BY created_at`,
        wanted
      )
      .toArray() as unknown as AgentRow[];
  }

  get(id: string): AgentRow | undefined {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec(
        `SELECT id, name, created_at, updated_at, allowed_emails, admin_email FROM agents
         WHERE id = ? LIMIT 1`,
        id
      )
      .toArray()[0] as unknown as AgentRow | undefined;
  }

  /**
   * `adminEmail` is the address that made the agent. It is the only time it is ever
   * written: there is no route that changes it, because an agent whose administrator
   * can be handed over is one that can be taken.
   *
   * It falls back to the first address on the access list, which is what an unguarded
   * deployment — where there is no signed-in caller to name — has to go on.
   */
  create(id: string, name: string, allowedEmails: string, adminEmail: string): AgentRow {
    this.ensureSchema();
    const now = Date.now();
    const admin = adminEmail.trim().toLowerCase() || firstEmail(allowedEmails);
    this.ctx.storage.sql.exec(
      `INSERT INTO agents (id, name, created_at, updated_at, allowed_emails, admin_email)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      name,
      now,
      now,
      allowedEmails,
      admin
    );
    // The row is in; this puts the same addresses in `agent_members` beside it.
    this.writeMembers(id, allowedEmails);
    return {
      id,
      name,
      created_at: now,
      updated_at: now,
      allowed_emails: allowedEmails,
      admin_email: admin,
    };
  }

  /**
   * Replace the access list. The caller keeps their own address on it: a user who
   * could edit themselves out would lock everyone, themselves included, out of an
   * agent that only they could have unlocked. The admin is untouched either way —
   * it is not part of this list and is never rewritten.
   */
  setAllowedEmails(id: string, allowedEmails: string) {
    this.ensureSchema();
    this.writeMembers(id, allowedEmails);
  }

  rename(id: string, name: string) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE agents SET name = ?, updated_at = ? WHERE id = ?`,
      name,
      Date.now(),
      id
    );
  }

  touch(id: string) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`UPDATE agents SET updated_at = ? WHERE id = ?`, Date.now(), id);
  }

  remove(id: string) {
    this.ensureSchema();
    // The member rows go too. Nothing else points at them, so one left behind would
    // be invisible for good — and would put the agent back on somebody's list if its
    // id were ever reused.
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`DELETE FROM agent_members WHERE agent_id = ?`, id);
      this.ctx.storage.sql.exec(`DELETE FROM agents WHERE id = ?`, id);
    });
  }
}
