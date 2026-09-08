import { DurableObject } from "cloudflare:workers";

/**
 * App-wide settings, split in two:
 *
 * - Tuning (model, prompt, temperature…): how the agent talks.
 * - Capabilities (`cap_*` plus the credentials they need): what the agent can *do* —
 *   search, read files, see images, draw, hear, schedule work, remember.
 *
 * One typed column per setting, in a single-row table: settings keep growing, and
 * columns keep them queryable and migratable instead of turning into one opaque blob.
 * Integers stand in for booleans because SQLite has no boolean type.
 *
 * API keys are stored here in plain text. That is deliberate for now — see README.
 */
export type Config = {
  model: string;
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

  /** Brave Search API key. Web search cannot run without it. */
  brave_api_key: string;
  /** OpenRouter model used for `generate_image`; billed on the existing OpenRouter key. */
  image_model: string;
  /** OpenRouter model used to transcribe audio uploads; same key, same bill. */
  transcription_model: string;
  /** Bot token from @BotFather. The bot is the agent's face on Telegram. */
  telegram_bot_token: string;
  /** The bot's @handle, without the @: a chat needs it to link back to the bot. */
  telegram_bot_username: string;
};

export const DEFAULT_CONFIG: Omit<Config, "model"> = {
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
  cap_telegram: 0,

  brave_api_key: "",
  image_model: "google/gemini-2.5-flash-image",
  transcription_model: "google/gemini-2.5-flash-lite",
  telegram_bot_token: "",
  telegram_bot_username: "",
};

/** The config columns, in the order they are written, excluding the primary key. */
const CONFIG_COLUMNS = ["model", ...Object.keys(DEFAULT_CONFIG)] as (keyof Config)[];

/** `ALTER TABLE` fragments for every column added after `config` first shipped. */
const CONFIG_MIGRATIONS = [
  `system_prompt TEXT NOT NULL DEFAULT ''`,
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
];

/** A fact the agent chose to keep. Memories are app-wide, not per session. */
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
export class SessionRegistry extends DurableObject {
  private ready = false;

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
      `CREATE TABLE IF NOT EXISTS memories (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         text TEXT NOT NULL,
         session_id TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`
    );
    this.ready = true;
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

  list(): SessionRow[] {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec(
        `SELECT id, title, created_at, updated_at, object_id, source, chat_id, chat_type,
                chat_username, chat_thread_id
         FROM sessions ORDER BY updated_at DESC`
      )
      .toArray() as unknown as SessionRow[];
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
   * Memory is app-wide on purpose: a fact worth keeping ("I use pnpm") is worth
   * keeping in the next session too, which is the whole point of remembering it.
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
}
