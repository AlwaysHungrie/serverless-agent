import { Agent, type Schedule } from "agents";
import {
  CAPABILITIES,
  enabled,
  runTool,
  toolDefinitions,
  type ScheduledTask,
  type ToolContext,
} from "./capabilities";
import { DEFAULT_CONFIG, type Config, type Memory, type SessionRegistry } from "./registry";

export type Env = {
  SessionAgent: DurableObjectNamespace;
  SessionRegistry: DurableObjectNamespace<SessionRegistry>;
  /** Object storage for attachment bytes: images, and voice-note clips. */
  FILES: R2Bucket;
  OPENROUTER_API_KEY: string;
  MODEL: string;
};

/** An OpenRouter message. Content is a string, or parts when an image rides along. */
type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Msg = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | Part[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

/** A conversation prefix plus its files: what one session hands another on a fork. */
export type Snapshot = { messages: StoredMessage[]; attachments: Attachment[] };

export type StoredMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  ts: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  ms: number;
  /** JSON array of attachment ids sent with this message. */
  attachments: string;
};

/** A file the user attached, or an image the agent drew. */
export type Attachment = {
  id: string;
  kind: "text" | "image";
  name: string;
  mime: string;
  /** Extracted text for a text file, a transcript for audio, a prompt for an image. */
  text: string;
  /** Legacy inline data URL. Rows written before attachments moved to R2. */
  data: string;
  /** R2 object key holding the bytes, for images and audio clips. Empty for text. */
  key: string;
  bytes: number;
  ts: number;
  /** 0 until the attachment has been sent with a turn. */
  used: number;
};

/** The models the app can be switched between, in the order the settings page lists them. */
export const MODELS = [
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", vision: false },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", vision: true },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini", vision: true },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", vision: true },
] as const;

/** Whether the chosen model can be sent an image at all. */
function modelSeesImages(model: string): boolean {
  return MODELS.find((m) => m.id === model)?.vision ?? false;
}

/** Fallback per-token pricing, used when OpenRouter does not return a cost. */
const MODEL_FALLBACK_PRICE: Record<string, { prompt: number; completion: number }> = {
  "deepseek/deepseek-v4-flash": { prompt: 0.000000088606, completion: 0.000000177212 },
};

const SYSTEM_PROMPT = "You are a concise assistant running inside a Cloudflare Durable Object.";

/** Asked once, on the first turn, to turn the opening exchange into a sidebar title. */
const TITLE_PROMPT =
  "Name this conversation in at most four words. Reply with the title only: no quotes, no punctuation at the end, no preamble.";

/** How many times a single turn may call tools before it must answer. */
const MAX_TOOL_ROUNDS = 6;

/**
 * Attachment ceilings, per kind. Bytes live in R2, so the limits are about what each
 * kind costs downstream rather than what SQLite will hold: a text file is inlined into
 * every prompt, an image is base64'd into one, and audio is transcribed once.
 */
const MAX_UPLOAD_BYTES = {
  text: 1_000_000,
  image: 10_000_000,
  audio: 25_000_000,
} as const;

const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|log|html?|xml|css|jsx?|tsx?|py|rb|go|rs|java|kt|c|h|cpp|sh|sql)$/i;

/**
 * One Durable Object instance == one agent session.
 * The instance name in the URL (/agents/session-agent/<session-id>) is the session id.
 */
export class SessionAgent extends Agent<Env> {
  private schemaReady = false;

  private exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec(query, ...(bindings as never[])).toArray() as T[];
  }

  private ensureSchema() {
    if (this.schemaReady) return;
    this.exec(
      `CREATE TABLE IF NOT EXISTS messages (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         role TEXT NOT NULL,
         content TEXT NOT NULL,
         ts INTEGER NOT NULL,
         prompt_tokens INTEGER NOT NULL DEFAULT 0,
         completion_tokens INTEGER NOT NULL DEFAULT 0,
         cost_usd REAL NOT NULL DEFAULT 0,
         ms INTEGER NOT NULL DEFAULT 0
       )`
    );
    // Bring forward databases created before the usage and attachment columns existed.
    for (const col of [
      "prompt_tokens INTEGER NOT NULL DEFAULT 0",
      "completion_tokens INTEGER NOT NULL DEFAULT 0",
      "cost_usd REAL NOT NULL DEFAULT 0",
      "ms INTEGER NOT NULL DEFAULT 0",
      "attachments TEXT NOT NULL DEFAULT '[]'",
    ]) {
      try {
        this.exec(`ALTER TABLE messages ADD COLUMN ${col}`);
      } catch {
        // Column already present.
      }
    }
    this.exec(
      `CREATE TABLE IF NOT EXISTS attachments (
         id TEXT PRIMARY KEY,
         kind TEXT NOT NULL,
         name TEXT NOT NULL,
         mime TEXT NOT NULL,
         text TEXT NOT NULL DEFAULT '',
         data TEXT NOT NULL DEFAULT '',
         key TEXT NOT NULL DEFAULT '',
         bytes INTEGER NOT NULL DEFAULT 0,
         ts INTEGER NOT NULL,
         used INTEGER NOT NULL DEFAULT 0
       )`
    );
    try {
      this.exec(`ALTER TABLE attachments ADD COLUMN key TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Column already present.
    }
    this.schemaReady = true;
  }

  async onRequest(request: Request): Promise<Response> {
    this.ensureSchema();
    await this.loadConfig();

    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    // Everything after /agents/session-agent/<session-id>.
    const route = segments.slice(segments.indexOf("session-agent") + 2);
    const path = route[0] ?? "";

    // Streaming owns its own metering: the object stays billable until the last token.
    if (request.method === "POST" && path === "stream") {
      const { message } = (await request.json()) as { message?: string };
      if (message === undefined) {
        return Response.json({ error: "body must be { message: string }" }, { status: 400 });
      }
      return await this.streamChat(message);
    }

    // Attachment bytes are served raw so an <img src> can point straight at them.
    if (request.method === "GET" && path === "files" && route[1]) {
      return await this.serveAttachment(route[1]);
    }

    let body: unknown;
    let status = 200;
    let turn: Record<string, unknown> | undefined;

    try {
      if (request.method === "POST" && path === "chat") {
        const result = await this.chat(((await request.json()) as { message: string }).message);
        body = result.body;
        turn = result.turn;
      } else if (request.method === "POST" && path === "files") {
        const result = await this.upload(request);
        body = result.body;
        status = result.status;
      } else if (request.method === "GET" && path === "files") {
        body = { attachments: this.pendingAttachments().map(publicAttachment) };
      } else if (request.method === "DELETE" && path === "files" && route[1]) {
        const row = this.attachment(route[1]);
        this.exec(`DELETE FROM attachments WHERE id = ? AND used = 0`, route[1]);
        // Only the pending row is deletable, so a surviving row means the bytes stay.
        if (row?.key && !this.attachment(route[1])) await this.env.FILES.delete(row.key);
        body = { ok: true };
      } else if (request.method === "GET" && path === "tasks") {
        body = { tasks: this.listTasks() };
      } else if (request.method === "DELETE" && path === "tasks" && route[1]) {
        body = { ok: this.cancelTask(route[1]) };
      } else if (request.method === "GET" && path === "messages") {
        body = { messages: this.messages() };
      } else if (request.method === "GET" && path === "export") {
        body = this.exportTurns(Number(url.searchParams.get("count") ?? "0"));
      } else if (request.method === "POST" && path === "import") {
        await this.importTurns((await request.json()) as Snapshot);
        body = { ok: true };
      } else if (request.method === "GET" && path === "summary") {
        body = this.summary();
      } else if (request.method === "POST" && path === "reset") {
        this.exec(`DELETE FROM messages`);
        await this.deleteObjects();
        this.exec(`DELETE FROM attachments`);
        for (const task of this.listTasks()) this.cancelTask(task.id);
        body = { ok: true };
      } else {
        status = 404;
        body = { error: `no route for ${request.method} ${url.pathname}` };
      }
    } catch (err) {
      status = 500;
      body = { error: err instanceof Error ? err.message : String(err) };
    }

    return Response.json(
      { ...(body as object), _meta: { session: this.name, request: { ...turn } } },
      { status }
    );
  }

  /* ------------------------------------------------------------ attachments -- */

  private attachment(id: string): Attachment | undefined {
    return this.exec<Attachment>(`SELECT * FROM attachments WHERE id = ?`, id)[0];
  }

  /** Uploaded but not yet sent: what the next turn will carry. */
  private pendingAttachments(): Attachment[] {
    return this.exec<Attachment>(`SELECT * FROM attachments WHERE used = 0 ORDER BY ts ASC`);
  }

  /**
   * Attachment bytes live in R2, so a big image or a long voice note never sits in
   * the Durable Object's SQLite. Rows written before the move still carry a data URL.
   */
  private async serveAttachment(id: string): Promise<Response> {
    const row = this.attachment(id);
    // Images and voice notes both keep their bytes; text files have none to serve.
    if (!row || (!row.key && !row.data)) return new Response("not found", { status: 404 });

    const CACHE = { "cache-control": "public, max-age=31536000, immutable" };
    if (row.key) {
      const object = await this.env.FILES.get(row.key);
      if (!object) return new Response("not found", { status: 404 });
      return new Response(object.body, {
        headers: { "content-type": row.mime, ...CACHE },
      });
    }

    const [meta, base64] = row.data.split(",", 2);
    const mime = meta?.match(/^data:([^;]+)/)?.[1] ?? row.mime;
    const binary = Uint8Array.from(atob(base64 ?? ""), (c) => c.charCodeAt(0));
    return new Response(binary, { headers: { "content-type": mime, ...CACHE } });
  }

  /** Put an upload's bytes in the bucket, namespaced by session, and hand back its key. */
  private async putObject(id: string, body: ArrayBuffer | Blob, mime: string): Promise<string> {
    const key = `${this.name}/${id}`;
    await this.env.FILES.put(key, body, { httpMetadata: { contentType: mime } });
    return key;
  }

  /** Drop every object this session holds in the bucket. */
  private async deleteObjects(): Promise<void> {
    const keys = this.exec<{ key: string }>(
      `SELECT key FROM attachments WHERE key != ''`
    ).map((r) => r.key);
    // R2 takes up to 1000 keys per delete call.
    for (let i = 0; i < keys.length; i += 1000) {
      await this.env.FILES.delete(keys.slice(i, i + 1000));
    }
  }

  /** The bytes behind an attachment, as the data URL OpenRouter wants. */
  private async dataUrlOf(a: Attachment): Promise<string> {
    if (!a.key) return a.data;
    const object = await this.env.FILES.get(a.key);
    if (!object) return "";
    return `data:${a.mime};base64,${bytesToBase64(await object.arrayBuffer())}`;
  }

  private insertAttachment(row: Omit<Attachment, "ts" | "used">): Attachment {
    const full: Attachment = { ...row, ts: Date.now(), used: 0 };
    this.exec(
      `INSERT INTO attachments (id, kind, name, mime, text, data, key, bytes, ts, used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      full.id,
      full.kind,
      full.name,
      full.mime,
      full.text,
      full.data,
      full.key,
      full.bytes,
      full.ts
    );
    return full;
  }

  /**
   * Take one uploaded file. Which files are accepted is decided by the capabilities
   * that are on: text needs File ingest, images need Image input, audio needs Audio
   * input. Audio is stored untranscribed; transcribing it is the model's own call.
   */
  private async upload(request: Request): Promise<{ body: unknown; status: number }> {
    const form = await request.formData();
    // The Workers FormData types entries loosely; the runtime hands back a File here.
    const file = form.get("file") as unknown as File | null;
    if (!file || typeof file === "string") {
      return { body: { error: "expected a file field" }, status: 400 };
    }
    const config = this.config();
    const mime = file.type || "application/octet-stream";
    const id = crypto.randomUUID().slice(0, 12);

    const limit =
      mime.startsWith("image/")
        ? MAX_UPLOAD_BYTES.image
        : mime.startsWith("audio/") || mime.startsWith("video/")
          ? MAX_UPLOAD_BYTES.audio
          : MAX_UPLOAD_BYTES.text;
    if (file.size > limit) {
      return {
        body: {
          error: `${file.name} is ${formatMb(file.size)}; the limit for this kind of file is ${formatMb(limit)}.`,
        },
        status: 413,
      };
    }

    if (mime.startsWith("image/")) {
      if (!enabled(config, "vision")) {
        return { body: { error: "Image input is off. Turn it on under Capabilities." }, status: 400 };
      }
      // Refuse here rather than at turn time: OpenRouter's own refusal is a bare 404,
      // and by then the message and the attachment have already been stored.
      if (!modelSeesImages(config.model)) {
        return {
          body: {
            error: `${config.model} cannot see images. Pick a multimodal model under Settings.`,
          },
          status: 400,
        };
      }
      const attachment = this.insertAttachment({
        id,
        kind: "image",
        name: file.name,
        mime,
        text: "",
        data: "",
        key: await this.putObject(id, await file.arrayBuffer(), mime),
        bytes: file.size,
      });
      return { body: { attachment: publicAttachment(attachment) }, status: 200 };
    }

    if (mime.startsWith("audio/") || mime.startsWith("video/")) {
      if (!enabled(config, "audio_input")) {
        return {
          body: { error: "Audio input is off. Turn it on under Capabilities." },
          status: 400,
        };
      }
      // Not transcribed here: the clip is stored as-is and the model decides whether
      // it needs the words, by calling transcribe_audio with this attachment's id.
      const attachment = this.insertAttachment({
        id,
        kind: "text",
        name: file.name,
        mime,
        text: "",
        data: "",
        key: await this.putObject(id, await file.arrayBuffer(), mime),
        bytes: file.size,
      });
      return { body: { attachment: publicAttachment(attachment) }, status: 200 };
    }

    if (!enabled(config, "file_ingest")) {
      return { body: { error: "File ingest is off. Turn it on under Capabilities." }, status: 400 };
    }
    if (!mime.startsWith("text/") && !isTextLike(mime, file.name)) {
      return {
        body: { error: `${file.name} is not a text format. Text, Markdown, CSV, JSON and source files work.` },
        status: 415,
      };
    }
    const attachment = this.insertAttachment({
      id,
      kind: "text",
      name: file.name,
      mime,
      text: await file.text(),
      data: "",
      // Kept as an object too, so the chat can offer the original file back.
      key: await this.putObject(id, await file.arrayBuffer(), mime),
      bytes: file.size,
    });
    return { body: { attachment: publicAttachment(attachment) }, status: 200 };
  }

  /**
   * Turn audio into text. OpenRouter has no /audio/transcriptions route, but many of
   * its models take audio as a chat input part, so this spends the key the Worker
   * already holds rather than asking the user for a second provider.
   */
  private async transcribe(file: File): Promise<string> {
    const format = audioFormat(file.type, file.name);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config().transcription_model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe this audio verbatim. Reply with the transcript alone — no preamble, no commentary, no quotation marks.",
              },
              {
                type: "input_audio",
                input_audio: { data: await base64(file), format },
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`transcription ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return (json.choices?.[0]?.message?.content ?? "").trim();
  }

  /**
   * Transcribe a stored clip on demand, and cache the words on its row so a second
   * call — or a reopened session — does not pay for the same audio twice.
   */
  private async transcribeAttachment(id: string): Promise<string> {
    const row = this.attachment(id);
    if (!row) return `No attachment with id ${id}.`;
    if (!row.mime.startsWith("audio/") && !row.mime.startsWith("video/")) {
      return `${row.name} is not audio.`;
    }
    if (row.text.trim()) return row.text;
    if (!enabled(this.config(), "audio_input")) {
      return "Audio input is off. Turn it on under Capabilities.";
    }
    const object = row.key ? await this.env.FILES.get(row.key) : null;
    if (!object) return `The bytes for ${row.name} are gone.`;
    const file = new File([await object.arrayBuffer()], row.name, { type: row.mime });
    const transcript = await this.transcribe(file);
    this.exec(`UPDATE attachments SET text = ? WHERE id = ?`, transcript, id);
    return transcript;
  }

  /* ------------------------------------------------------------- transcript -- */

  private rows(): StoredMessage[] {
    return this.exec<StoredMessage>(
      `SELECT id, role, content, ts, prompt_tokens, completion_tokens, cost_usd, ms, attachments
       FROM messages ORDER BY id ASC`
    );
  }

  /**
   * The transcript as the API serves it: each row's attachment ids resolved to the
   * metadata the UI needs to draw them, so reopening a session shows the files and
   * images that were sent with each message.
   */
  private messages() {
    return this.rows().map((row) => ({
      ...row,
      attachments: this.attachmentsOf(row).map(publicAttachment),
    }));
  }

  private attachmentsOf(row: StoredMessage): Attachment[] {
    return (JSON.parse(row.attachments || "[]") as string[])
      .map((id) => this.attachment(id))
      .filter((a): a is Attachment => !!a);
  }

  /**
   * The transcript to resend, newest-last. A context window of N keeps only the last
   * N messages, so a long session stops growing its prompt (and its per-turn cost)
   * without limit; 0 keeps everything.
   */
  private async history(): Promise<Msg[]> {
    const limit = this.config().context_messages;
    const rows = this.rows();
    const kept = limit > 0 ? rows.slice(-limit) : rows;
    return Promise.all(
      kept.map(async (row) => ({ role: row.role, content: await this.contentOf(row) }))
    );
  }

  /** Rebuild a stored row's content, putting its images back as image parts. */
  private async contentOf(row: StoredMessage): Promise<string | Part[]> {
    const attached = this.attachmentsOf(row);
    const text = withAudioNotes(row.content, attached);
    const images = attached.filter((a) => a.kind === "image");
    if (images.length === 0) return text;
    return [
      { type: "text", text },
      ...(await this.imageParts(images)),
    ];
  }

  /** Image attachments as OpenRouter parts, with their bytes read back from R2. */
  private async imageParts(images: Attachment[]): Promise<Part[]> {
    const urls = await Promise.all(images.map((a) => this.dataUrlOf(a)));
    return urls
      .filter((url) => url !== "")
      .map((url) => ({ type: "image_url" as const, image_url: { url } }));
  }

  private systemPrompt(): string {
    const parts = [SYSTEM_PROMPT];
    const custom = this.config().system_prompt.trim();
    if (custom) parts.push(custom);
    if (this.memories.length > 0) {
      // Memories are injected rather than recalled by tool call, so the model can use
      // what it knows without spending a round trip to find out that it knows it.
      parts.push(
        `What you remember about this user:\n${this.memories.map((m) => `- ${m.text}`).join("\n")}`
      );
    }
    const ready = CAPABILITIES.filter((c) => enabled(this.config(), c.id)).map((c) => c.label);
    if (ready.length > 0) parts.push(`Capabilities available to you: ${ready.join(", ")}.`);
    return parts.join("\n\n");
  }

  /**
   * The user's turn: their text, plus whatever they attached. Text files are inlined
   * into the message so any model can read them; images become parts, which only a
   * multimodal model will accept.
   */
  private async userMessage(message: string, attachments: Attachment[]): Promise<Msg> {
    const documents = attachments.filter(
      (a) => a.kind === "text" && !isAudioAttachment(a) && a.text.trim() !== ""
    );
    const withDocs = documents.length
      ? [
          message,
          ...documents.map((d) => `--- attached file: ${d.name} ---\n${d.text}`),
        ].join("\n\n")
      : message;
    const text = withAudioNotes(withDocs, attachments);

    const images = attachments.filter((a) => a.kind === "image");
    if (images.length === 0) return { role: "user", content: text };
    return {
      role: "user",
      content: [{ type: "text", text }, ...(await this.imageParts(images))],
    };
  }

  private async modelMessages(message: string, attachments: Attachment[]): Promise<Msg[]> {
    return [
      { role: "system", content: this.systemPrompt() },
      ...(await this.history()),
      await this.userMessage(message, attachments),
    ];
  }

  private priceOf(promptTokens: number, completionTokens: number, reported?: number) {
    if (typeof reported === "number") return reported;
    const p = MODEL_FALLBACK_PRICE[this.model()];
    return p ? promptTokens * p.prompt + completionTokens * p.completion : 0;
  }

  private saveUser(content: string, attachments: Attachment[]) {
    this.exec(
      `INSERT INTO messages (role, content, ts, attachments) VALUES ('user', ?, ?, ?)`,
      content,
      Date.now(),
      JSON.stringify(attachments.map((a) => a.id))
    );
    // An attachment belongs to the turn that sent it: it must not ride along again.
    for (const a of attachments) this.exec(`UPDATE attachments SET used = 1 WHERE id = ?`, a.id);
  }

  private saveAssistant(
    content: string,
    promptTokens: number,
    completionTokens: number,
    cost: number,
    ms: number,
    attachmentIds: string[] = []
  ) {
    this.exec(
      `INSERT INTO messages (role, content, ts, prompt_tokens, completion_tokens, cost_usd, ms, attachments)
       VALUES ('assistant', ?, ?, ?, ?, ?, ?, ?)`,
      content,
      Date.now(),
      promptTokens,
      completionTokens,
      cost,
      ms,
      JSON.stringify(attachmentIds)
    );
  }

  /**
   * The first `count` messages with every attachment they reference, bytes included
   * by key. This is what a fork copies: enough to replay the conversation in a new
   * session without reaching back into this one.
   */
  private exportTurns(count: number): Snapshot {
    const rows = this.rows().slice(0, Math.max(0, count));
    const ids = new Set(rows.flatMap((row) => JSON.parse(row.attachments || "[]") as string[]));
    const attachments = [...ids]
      .map((id) => this.attachment(id))
      .filter((a): a is Attachment => !!a);
    return { messages: rows, attachments };
  }

  /**
   * Replay a snapshot into this (empty) session. Attachment ids are kept, so the
   * copied messages still point at their files, but the bytes are copied to keys
   * under this session so deleting either side leaves the other intact.
   */
  private async importTurns(snapshot: Snapshot): Promise<void> {
    for (const a of snapshot.attachments ?? []) {
      let key = "";
      if (a.key) {
        const object = await this.env.FILES.get(a.key);
        if (object) key = await this.putObject(a.id, await object.arrayBuffer(), a.mime);
      }
      this.exec(
        `INSERT OR REPLACE INTO attachments (id, kind, name, mime, text, data, key, bytes, ts, used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        a.id,
        a.kind,
        a.name,
        a.mime,
        a.text,
        key ? "" : a.data,
        key,
        a.bytes,
        a.ts
      );
    }
    for (const row of snapshot.messages ?? []) {
      this.exec(
        `INSERT INTO messages (role, content, ts, prompt_tokens, completion_tokens, cost_usd, ms, attachments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        row.role,
        row.content,
        row.ts,
        row.prompt_tokens,
        row.completion_tokens,
        row.cost_usd,
        row.ms,
        row.attachments || "[]"
      );
    }
  }

  private registry() {
    return this.env.SessionRegistry.get(this.env.SessionRegistry.idFromName("global"));
  }

  /* ----------------------------------------------------------------- config -- */

  /**
   * Model, tuning and capabilities, taken from app settings rather than this object,
   * so a change on the settings or capabilities page applies everywhere. Read once
   * per request and cached for that request, because the sync code paths (pricing,
   * summary, message assembly) cannot await an RPC.
   */
  private currentConfig: Config | null = null;
  private memories: Memory[] = [];

  private async loadConfig() {
    const config = await this.registry().config(this.env.MODEL);
    this.currentConfig = {
      ...config,
      model: MODELS.some((m) => m.id === config.model) ? config.model : this.env.MODEL,
    };
    this.memories = enabled(this.currentConfig, "memory")
      ? ((await this.registry().recall("", 20)) as Memory[])
      : [];
  }

  private config(): Config {
    return this.currentConfig ?? { model: this.env.MODEL, ...DEFAULT_CONFIG };
  }

  private model(): string {
    return this.config().model;
  }

  /* ------------------------------------------------------------------ tools -- */

  private toolContext(): ToolContext {
    return {
      config: this.config(),
      sessionId: this.name,
      openrouterKey: this.env.OPENROUTER_API_KEY,
      registry: this.registry(),
      saveImage: async (dataUrl, prompt) => {
        const id = crypto.randomUUID().slice(0, 12);
        const mime = dataUrl.match(/^data:([^;]+)/)?.[1] ?? "image/png";
        const bytes = base64ToBytes(dataUrl.split(",", 2)[1] ?? "");
        this.insertAttachment({
          id,
          kind: "image",
          name: `${prompt.slice(0, 40)}.png`,
          mime,
          text: prompt,
          data: "",
          key: await this.putObject(id, bytes, mime),
          bytes: bytes.byteLength,
        });
        // Marked used straight away: it belongs to the reply, not to the next turn.
        this.exec(`UPDATE attachments SET used = 1 WHERE id = ?`, id);
        return `/agents/session-agent/${encodeURIComponent(this.name)}/files/${id}`;
      },
      transcribeAttachment: (id) => this.transcribeAttachment(id),
      schedule: (when, prompt) => this.scheduleTask(when, prompt),
      listTasks: () => this.listTasks(),
      cancelTask: (id) => this.cancelTask(id),
    };
  }

  /** Run every tool the model asked for, and shape the results as `tool` messages. */
  private async runToolCalls(calls: ToolCall[]): Promise<{ messages: Msg[]; names: string[] }> {
    const ctx = this.toolContext();
    const messages: Msg[] = [];
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        // A malformed argument blob is the model's mistake to see and correct.
      }
      const result = await runTool(call.function.name, args, ctx);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
    return { messages, names: calls.map((c) => c.function.name) };
  }

  /* ------------------------------------------------------------- scheduling -- */

  /**
   * Accepts the three ways a task gets asked for: "in 900 seconds", "at this
   * timestamp", and "every day at nine" as a cron expression.
   */
  private async scheduleTask(when: string, prompt: string): Promise<ScheduledTask> {
    const seconds = Number(when);
    const isCron = /^[\d*/,\-\s]+$/.test(when) && when.trim().split(/\s+/).length === 5;
    let at: Date | number | string;
    if (Number.isFinite(seconds)) {
      at = seconds;
    } else if (isCron) {
      at = when.trim();
    } else {
      const date = new Date(when);
      if (Number.isNaN(date.getTime())) {
        throw new Error(`"${when}" is not a delay, a timestamp or a cron expression`);
      }
      at = date;
    }
    const schedule = await this.schedule(at as never, "runScheduledTask", { prompt });
    return describeSchedule(schedule as Schedule<{ prompt: string }>);
  }

  private listTasks(): ScheduledTask[] {
    return [...this.getSchedules<{ prompt: string }>()].map(describeSchedule);
  }

  private cancelTask(id: string): boolean {
    return this.cancelSchedule(id) as unknown as boolean;
  }

  /**
   * A scheduled task runs a turn with nobody watching: the prompt is stored as the
   * user message and the reply lands in the transcript, so the session reads as a
   * conversation when the user comes back to it.
   */
  async runScheduledTask(payload: { prompt: string }) {
    this.ensureSchema();
    await this.loadConfig();
    await this.chat(`[scheduled task] ${payload.prompt}`);
  }

  /* ------------------------------------------------------------- OpenRouter -- */

  /**
   * One OpenRouter call. `capabilities: false` sends a bare request — used for the
   * title call, which must not inherit the user's tuning or the agent's tools.
   */
  private openrouter(messages: Msg[], stream: boolean, signal?: AbortSignal, capabilities = true) {
    const config = this.config();
    const body: Record<string, unknown> = {
      model: this.model(),
      messages,
      stream,
      usage: { include: true },
    };

    if (capabilities) {
      body.temperature = config.temperature;
      if (config.max_tokens > 0) body.max_tokens = config.max_tokens;
      if (config.reasoning_effort !== "off") body.reasoning = { effort: config.reasoning_effort };
      const tools = toolDefinitions(config);
      if (tools.length > 0) body.tools = tools;
    }

    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  /**
   * The first user message is what names the session. Before it is stored the
   * transcript is empty, so an empty table means "this turn is the first one".
   */
  private isFirstTurn() {
    return (this.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM messages`)[0]?.n ?? 0) === 0;
  }

  /** Whether this turn should name the session: the first one, if auto-title is on. */
  private shouldName() {
    return this.isFirstTurn() && this.config().auto_title === 1;
  }

  /**
   * Ask the model for a short name for the session and write it to the registry, so
   * the sidebar stops showing "New session". Best effort: a failed title must never
   * fail the turn it was generated from.
   */
  private async nameSession(userMessage: string, reply: string) {
    try {
      const res = await this.openrouter(
        [
          { role: "system", content: TITLE_PROMPT },
          { role: "user", content: `User: ${userMessage}\n\nAssistant: ${reply.slice(0, 500)}` },
        ],
        false,
        undefined,
        false
      );
      if (!res.ok) return;
      const json = (await res.json()) as { choices: { message: { content: string } }[] };
      const title = (json.choices[0]?.message?.content ?? "")
        .replace(/^["'\s]+|["'\s.]+$/g, "")
        .slice(0, 60);
      if (!title) return;
      await this.registry().rename(this.name, title);
    } catch {
      // Leave the placeholder title in place.
    }
  }

  /**
   * A whole turn, without streaming: call the model, run any tools it asks for, call
   * it again with the results, and keep going until it answers or runs out of rounds.
   */
  private async chat(message: string) {
    const attachments = this.pendingAttachments();
    const convo = await this.modelMessages(message, attachments);
    const first = this.shouldName();
    this.saveUser(message, attachments);

    const llmStart = Date.now();
    let promptTokens = 0;
    let completionTokens = 0;
    let cost = 0;
    let reply = "";
    const toolsUsed: string[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.openrouter(convo, false);
      if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`);

      const json = (await res.json()) as {
        choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[];
        usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
      };
      promptTokens += json.usage?.prompt_tokens ?? 0;
      completionTokens += json.usage?.completion_tokens ?? 0;
      cost += this.priceOf(
        json.usage?.prompt_tokens ?? 0,
        json.usage?.completion_tokens ?? 0,
        json.usage?.cost
      );

      const choice = json.choices[0]?.message;
      reply = choice?.content ?? "";
      const calls = choice?.tool_calls ?? [];
      if (calls.length === 0) break;

      convo.push({ role: "assistant", content: reply, tool_calls: calls });
      const { messages, names } = await this.runToolCalls(calls);
      convo.push(...messages);
      toolsUsed.push(...names);
    }

    const llmMs = Date.now() - llmStart;
    this.saveAssistant(reply, promptTokens, completionTokens, cost, llmMs);
    if (first) await this.nameSession(message, reply);

    return {
      body: { reply, tools: toolsUsed },
      turn: {
        llm_ms: llmMs,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        llm_cost_usd: cost,
        tools: toolsUsed,
      },
    };
  }

  /**
   * Stream a reply as SSE. The object stays resident — and billable — for the whole
   * stream, so duration is metered when the stream ends, whether it completed or the
   * client stopped it. A stopped reply keeps its partial text and its token cost,
   * because OpenRouter has already generated (and charged for) what arrived.
   *
   * Tool calls stream too: when a round ends in tool calls, the tools run, a `tool`
   * event tells the client what is happening, and the next round starts. Text from
   * every round is forwarded as it arrives.
   */
  private async streamChat(message: string): Promise<Response> {
    const attachments = this.pendingAttachments();
    const convo = await this.modelMessages(message, attachments);
    const first = this.shouldName();
    this.saveUser(message, attachments);

    const encoder = new TextEncoder();
    const upstream = new AbortController();
    const llmStart = Date.now();

    let text = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let cost = 0;
    let finished = false;

    const finish = (aborted: boolean) => {
      if (finished) return;
      finished = true;
      const llmMs = Date.now() - llmStart;
      this.saveAssistant(
        text + (aborted ? "\n\n_(stopped)_" : ""),
        promptTokens,
        completionTokens,
        cost,
        llmMs
      );
      return { cost, llmMs };
    };

    const self = this;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

        try {
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const res = await self.openrouter(convo, true, upstream.signal);
            if (!res.ok || !res.body) {
              send({ type: "error", error: `openrouter ${res.status}: ${await res.text()}` });
              finish(false);
              controller.close();
              return;
            }

            const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
            const calls = new Map<number, ToolCall>();
            let roundText = "";
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += value;

              // OpenRouter sends SSE frames separated by a blank line.
              let cut: number;
              while ((cut = buffer.indexOf("\n\n")) !== -1) {
                const frame = buffer.slice(0, cut);
                buffer = buffer.slice(cut + 2);
                const line = frame.split("\n").find((l) => l.startsWith("data: "));
                if (!line) continue;
                const payload = line.slice(6).trim();
                if (payload === "[DONE]") continue;

                const chunk = JSON.parse(payload) as {
                  choices?: {
                    delta?: {
                      content?: string;
                      tool_calls?: {
                        index: number;
                        id?: string;
                        function?: { name?: string; arguments?: string };
                      }[];
                    };
                  }[];
                  usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
                };

                const delta = chunk.choices?.[0]?.delta;
                if (delta?.content) {
                  roundText += delta.content;
                  text += delta.content;
                  send({ type: "delta", text: delta.content });
                }
                // Tool calls arrive in fragments keyed by index: name first, then the
                // argument JSON a few characters at a time.
                for (const part of delta?.tool_calls ?? []) {
                  const call = calls.get(part.index) ?? {
                    id: "",
                    type: "function" as const,
                    function: { name: "", arguments: "" },
                  };
                  if (part.id) call.id = part.id;
                  if (part.function?.name) call.function.name = part.function.name;
                  if (part.function?.arguments) call.function.arguments += part.function.arguments;
                  calls.set(part.index, call);
                }
                if (chunk.usage) {
                  promptTokens += chunk.usage.prompt_tokens;
                  completionTokens += chunk.usage.completion_tokens;
                  cost += self.priceOf(
                    chunk.usage.prompt_tokens,
                    chunk.usage.completion_tokens,
                    chunk.usage.cost
                  );
                }
              }
            }

            const pending = [...calls.values()].filter((c) => c.function.name);
            if (pending.length === 0) break;

            for (const call of pending) send({ type: "tool", name: call.function.name });
            convo.push({ role: "assistant", content: roundText, tool_calls: pending });
            const { messages } = await self.runToolCalls(pending);
            convo.push(...messages);
            for (const call of pending) send({ type: "tool_done", name: call.function.name });
          }

          const result = finish(false);
          // Name the session before the client is told the turn is over, so its
          // refresh of the session list picks the new title up.
          if (first) await self.nameSession(message, text);
          send({
            type: "usage",
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            cost_usd: result?.cost ?? 0,
            llm_ms: result?.llmMs ?? 0,
          });
          send({ type: "done" });
          controller.close();
        } catch (err) {
          if (!finished) {
            send({ type: "error", error: err instanceof Error ? err.message : String(err) });
            finish(false);
          }
          controller.close();
        }
      },
      // The client hit stop: drop the upstream call and bank what we already have.
      cancel() {
        upstream.abort();
        finish(true);
      },
    });

    return new Response(body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  /**
   * What this session knows about itself: the transcript and the LLM spend, which
   * OpenRouter reports exactly per call.
   *
   * Cloudflare's own costs are deliberately absent. See
   * docs/cloudflare-durable-object-costs.md for how to read them from the GraphQL
   * Analytics API, and why measuring them from inside the object does not work.
   */
  private summary() {
    const row = this.exec<{ n: number; prompt: number; completion: number; cost: number }>(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(prompt_tokens), 0) AS prompt,
              COALESCE(SUM(completion_tokens), 0) AS completion,
              COALESCE(SUM(cost_usd), 0) AS cost
       FROM messages`
    )[0];

    return {
      session: this.name,
      messages: row?.n ?? 0,
      llm: {
        model: this.model(),
        prompt_tokens: row?.prompt ?? 0,
        completion_tokens: row?.completion ?? 0,
        cost_usd: row?.cost ?? 0,
      },
      tasks: this.listTasks(),
      sqlite_bytes: this.ctx.storage.sql.databaseSize,
    };
  }
}

/** Attachment rows carry a whole image; the API sends everything except the bytes. */
function isAudioAttachment(a: Attachment): boolean {
  return a.mime.startsWith("audio/") || a.mime.startsWith("video/");
}

/**
 * Audio rides along as a clip, not as words: the message names each one and hands the
 * model its id, so it can call transcribe_audio when the words actually matter.
 */
function withAudioNotes(text: string, attachments: Attachment[]): string {
  const clips = attachments.filter(isAudioAttachment);
  if (clips.length === 0) return text;
  const notes = clips.map((a) =>
    a.text.trim()
      ? `--- attached audio: ${a.name} (id ${a.id}), already transcribed ---\n${a.text}`
      : `--- attached audio: ${a.name} (id ${a.id}), not transcribed. Call transcribe_audio with attachment_id "${a.id}" if you need the words. ---`
  );
  return [text, ...notes].filter((part) => part.trim() !== "").join("\n\n");
}

function publicAttachment(a: Attachment) {
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    mime: a.mime,
    bytes: a.bytes,
    chars: a.text.length,
    // Enough of the text (or of an audio transcript, once one exists) for the UI.
    preview: a.kind === "text" ? a.text.slice(0, 400) : "",
  };
}

function describeSchedule(schedule: Schedule<{ prompt: string }>): ScheduledTask {
  const when =
    schedule.type === "cron"
      ? `cron ${(schedule as { cron: string }).cron}`
      : new Date(schedule.time * 1000).toISOString();
  return { id: schedule.id, prompt: schedule.payload?.prompt ?? "", when };
}

function isTextLike(mime: string, name: string): boolean {
  return (
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/x-yaml" ||
    TEXT_EXTENSIONS.test(name)
  );
}

async function base64(file: File): Promise<string> {
  return bytesToBase64(await file.arrayBuffer());
}

function base64ToBytes(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function formatMb(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.round(bytes / 1000)} kB`;
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked, because spreading a megabyte into String.fromCharCode blows the stack.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/**
 * The format name OpenRouter wants beside the audio bytes. It is picky about the
 * container, so anything unrecognised is reported here rather than as a 400 from
 * upstream.
 */
function audioFormat(mime: string, name: string): string {
  const subtype = mime.split("/")[1]?.split(";")[0]?.toLowerCase() ?? "";
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const candidate = AUDIO_FORMATS[subtype] ?? AUDIO_FORMATS[extension];
  if (!candidate) {
    throw new Error(`${name} is not an audio format transcription accepts. WAV and MP3 work.`);
  }
  return candidate;
}

const AUDIO_FORMATS: Record<string, string> = {
  wav: "wav",
  wave: "wav",
  "x-wav": "wav",
  mp3: "mp3",
  mpeg: "mp3",
  mpga: "mp3",
};
