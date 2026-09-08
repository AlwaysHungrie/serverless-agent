import { createOpenAI } from "@ai-sdk/openai";
import { Workspace } from "@cloudflare/shell";
import { Think, type StepContext, type TurnConfig, type TurnContext } from "@cloudflare/think";
import type { Schedule } from "agents";
import { jsonSchema, tool, type ModelMessage, type ToolSet, type UIMessage } from "ai";
import {
  CAPABILITIES,
  enabled,
  runTool,
  toolsFor,
  type ScheduledTask,
  type ToolContext,
} from "./capabilities";
import { DEFAULT_CONFIG, type Config, type Memory, type SessionRegistry } from "./registry";
import {
  Telegram,
  addressesBot,
  messageFiles,
  messageTextWithQuote,
  type TelegramMessage,
} from "./telegram";

export type Env = {
  SessionAgent: DurableObjectNamespace<SessionAgent>;
  SessionRegistry: DurableObjectNamespace<SessionRegistry>;
  /** Object storage the workspace spills large files into: images, PDFs, clips. */
  FILES: R2Bucket;
  OPENROUTER_API_KEY: string;
  MODEL: string;
  /** Telegram's API host. Only set to stand a local Bot API server in its place. */
  TELEGRAM_API_BASE?: string;
};

/**
 * A file the user attached, or an image the agent drew. The bytes live in the Think
 * workspace — a virtual filesystem the model reads with its own tools — and this row
 * is the metadata the UI needs to draw the file and the turn needs to name it.
 */
export type Attachment = {
  id: string;
  kind: "text" | "image" | "pdf";
  name: string;
  mime: string;
  /** Extracted text for a text file, a transcript for audio, a prompt for an image. */
  text: string;
  /** Workspace path holding the bytes. */
  path: string;
  /** Workspace path of a PNG of a PDF's first page. Empty for everything else. */
  thumb_path: string;
  bytes: number;
  ts: number;
  /** 0 until the attachment has been sent with a turn. */
  used: number;
};

/** An attachment with its bytes, which is how one session hands a file to another. */
export type PackedAttachment = Attachment & { data: string; thumb: string };

/** A conversation prefix plus its files: what one session hands another on a fork. */
export type Snapshot = {
  messages: UIMessage[];
  attachments: PackedAttachment[];
  /** Which message carried which file, and what each question actually said. */
  links: { message_id: string; attachment_id: string }[];
  texts: { message_id: string; text: string }[];
  /** Files of the question the fork dropped: they return to the composer, unsent. */
  pending?: PackedAttachment[];
};

/**
 * One segment of an assistant turn, in the order it happened — what it said, and the
 * tools it ran between saying things. Derived from Think's message parts on read
 * rather than stored, so the transcript stays the framework's to own.
 */
export type TurnStep =
  | { kind: "text"; text: string }
  | { kind: "tools"; tools: { name: string; ok: boolean }[] };

/** The shape the frontend reads a transcript in. */
export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  ms: number;
  attachments: ReturnType<typeof publicAttachment>[];
  /** JSON array of `TurnStep`. Empty for user messages and for tool-free turns. */
  steps: string;
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
 * Attachment ceilings, per kind. Bytes spill to R2, so the limits are about what each
 * kind costs downstream rather than what SQLite will hold.
 */
const MAX_UPLOAD_BYTES = {
  text: 1_000_000,
  pdf: 8_000_000,
  image: 10_000_000,
  audio: 25_000_000,
} as const;

/** A first-page render at card width. Anything larger is not a thumbnail. */
const MAX_THUMBNAIL_BYTES = 2_000_000;

const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|log|html?|xml|css|jsx?|tsx?|py|rb|go|rs|java|kt|c|h|cpp|sh|sql)$/i;

/** Where an attachment's bytes sit in the workspace. */
function uploadPath(id: string, name: string): string {
  return `uploads/${id}/${safeName(name)}`;
}

/** A file name the workspace can hold: no separators, no traversal, never empty. */
function safeName(name: string): string {
  const cleaned = name.replace(/[/\\]+/g, "_").replace(/^\.+/, "").trim();
  return cleaned.slice(0, 100) || "file";
}

export class SessionAgent extends Think<Env> {
  /**
   * Attachment bytes, and anything the model writes, live in one workspace, with R2
   * taking the large files off SQLite.
   */
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.FILES,
    name: () => this.name,
  });

  /** Six rounds of tools per turn, as before Think owned the loop. */
  override maxSteps = MAX_TOOL_ROUNDS;

  private schemaReady = false;
  private currentConfig: Config | undefined;
  private memories: Memory[] = [];

  /** Usage accumulated by `onStepFinish` for the turn that is running now. */
  private turnUsage = { prompt: 0, completion: 0, cost: 0, started: 0 };

  private exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec(query, ...(bindings as never[])).toArray() as T[];
  }

  /**
   * Think owns the transcript, so these tables hold only what it has no opinion
   * about: what an attachment is, which message carried it, and what a turn cost.
   */
  private ensureSchema() {
    if (this.schemaReady) return;
    this.exec(
      `CREATE TABLE IF NOT EXISTS attachments (
         id TEXT PRIMARY KEY,
         kind TEXT NOT NULL,
         name TEXT NOT NULL,
         mime TEXT NOT NULL,
         text TEXT NOT NULL DEFAULT '',
         path TEXT NOT NULL DEFAULT '',
         thumb_path TEXT NOT NULL DEFAULT '',
         bytes INTEGER NOT NULL DEFAULT 0,
         ts INTEGER NOT NULL,
         used INTEGER NOT NULL DEFAULT 0
       )`
    );
    this.exec(
      `CREATE TABLE IF NOT EXISTS message_files (
         message_id TEXT NOT NULL,
         attachment_id TEXT NOT NULL,
         PRIMARY KEY (message_id, attachment_id)
       )`
    );
    // What the user actually typed. The message Think stores also names the files the
    // turn carried, and that annotation is for the model, not for the chat bubble.
    this.exec(
      `CREATE TABLE IF NOT EXISTS message_text (
         message_id TEXT PRIMARY KEY,
         text TEXT NOT NULL
       )`
    );
    // One row per assistant message: what the turn spent, which Think does not track.
    this.exec(
      `CREATE TABLE IF NOT EXISTS usage (
         message_id TEXT PRIMARY KEY,
         prompt_tokens INTEGER NOT NULL DEFAULT 0,
         completion_tokens INTEGER NOT NULL DEFAULT 0,
         cost_usd REAL NOT NULL DEFAULT 0,
         ms INTEGER NOT NULL DEFAULT 0,
         ts INTEGER NOT NULL DEFAULT 0
       )`
    );
    this.schemaReady = true;
  }

  /* ----------------------------------------------------------------- config -- */

  private registry() {
    return this.env.SessionRegistry.get(this.env.SessionRegistry.idFromName("global"));
  }

  /**
   * Settings are read per turn rather than per boot: an object can live for days
   * between messages, and a stale temperature is a confusing thing to debug.
   */
  private async loadConfig() {
    this.currentConfig = await this.registry().config(this.env.MODEL);
    this.memories = enabled(this.currentConfig, "memory")
      ? await this.registry().recall("", 50)
      : [];
  }

  private config(): Config {
    return this.currentConfig ?? { model: this.env.MODEL, ...DEFAULT_CONFIG };
  }

  private model(): string {
    return this.config().model;
  }

  /** OpenRouter through the AI SDK's OpenAI-compatible client. */
  private openrouter() {
    return createOpenAI({
      apiKey: this.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }

  getModel() {
    return this.openrouter()(this.model());
  }

  getSystemPrompt() {
    return this.systemPrompt();
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
    parts.push(
      "Files the user attaches are written to the workspace under uploads/, and every message names the ones it carries. Open one with the read tool when the question is about it."
    );
    return parts.join("\n\n");
  }

  /**
   * Every knob the settings page owns, applied per turn: model, prompt, sampling,
   * reply cap, reasoning effort, context window, and the capability tools that are
   * ready to run.
   */
  override async beforeTurn(_ctx: TurnContext): Promise<TurnConfig> {
    this.ensureSchema();
    await this.loadConfig();
    const config = this.config();
    this.turnUsage = { prompt: 0, completion: 0, cost: 0, started: Date.now() };

    return {
      model: this.openrouter()(config.model),
      instructions: this.systemPrompt(),
      tools: this.capabilityTools(config),
      temperature: config.temperature,
      ...(config.max_tokens > 0 ? { maxOutputTokens: config.max_tokens } : {}),
      ...(config.reasoning_effort !== "off"
        ? { providerOptions: { openai: { reasoningEffort: config.reasoning_effort } } }
        : {}),
      messages: await this.modelMessages(config),
    };
  }

  /**
   * The conversation as the model receives it. Think stores the words; the pictures
   * are put back here, read from the workspace at turn time rather than carried in
   * the transcript, so a session holding an 8MB PDF does not carry it in every row.
   *
   * A context window of N keeps only the last N messages, so a long session stops
   * growing its prompt — and its per-turn cost — without limit. 0 keeps everything.
   */
  private async modelMessages(config: Config): Promise<ModelMessage[]> {
    const all = (await this.getMessages()).filter(
      (m) => m.role === "user" || m.role === "assistant"
    );
    const limit = config.context_messages;
    const kept = limit > 0 ? all.slice(-limit) : all;

    const messages: ModelMessage[] = [];
    for (const message of kept) {
      const text = textOf(message);
      if (message.role === "assistant") {
        if (text.trim()) messages.push({ role: "assistant", content: text });
        continue;
      }
      const parts = await this.fileParts(this.attachmentsOf(message.id));
      messages.push(
        parts.length === 0
          ? { role: "user", content: text }
          : { role: "user", content: [{ type: "text", text }, ...parts] }
      );
    }
    return messages;
  }

  /**
   * Images and PDFs as model content parts. They are sent with the message rather
   * than read through a tool: a tool result has to be text, so handing a page back
   * that way is not something an OpenAI-shaped API will accept.
   */
  private async fileParts(attachments: Attachment[]): Promise<
    ({ type: "image"; image: string } | { type: "file"; data: string; mediaType: string; filename: string })[]
  > {
    const parts: (
      | { type: "image"; image: string }
      | { type: "file"; data: string; mediaType: string; filename: string }
    )[] = [];
    for (const a of attachments) {
      if (a.kind !== "image" && a.kind !== "pdf") continue;
      const base64 = await this.readBase64(a.path);
      if (!base64) continue;
      parts.push(
        a.kind === "image"
          ? { type: "image", image: `data:${a.mime};base64,${base64}` }
          : {
              type: "file",
              data: `data:application/pdf;base64,${base64}`,
              mediaType: "application/pdf",
              filename: a.name,
            }
      );
    }
    return parts;
  }

  /**
   * The capability tools, wrapped for the AI SDK. Their JSON Schema is reused as is,
   * so a tool added in `capabilities.ts` reaches the model with no work here. They
   * merge with Think's own workspace tools — read, write, edit, grep, bash.
   */
  private capabilityTools(config: Config): ToolSet {
    const context = this.toolContext(config);
    const tools: ToolSet = {};
    for (const spec of toolsFor(config)) {
      tools[spec.name] = tool({
        description: spec.description,
        inputSchema: jsonSchema(spec.parameters as never),
        // A failure is returned rather than thrown, so the model reads what went
        // wrong and can correct itself on the next round.
        execute: async (args) =>
          (await runTool(spec.name, args as Record<string, unknown>, context)).content,
      });
    }
    return tools;
  }

  private toolContext(config: Config): ToolContext {
    return {
      config,
      sessionId: this.name,
      openrouterKey: this.env.OPENROUTER_API_KEY,
      registry: this.registry(),
      saveImage: async (dataUrl, prompt) => {
        const id = crypto.randomUUID().slice(0, 12);
        const mime = dataUrl.match(/^data:([^;]+)/)?.[1] ?? "image/png";
        const bytes = base64ToBytes(dataUrl.split(",", 2)[1] ?? "");
        const name = `${prompt.slice(0, 40) || "image"}.png`;
        const path = uploadPath(id, name);
        await this.workspace.writeFileBytes(path, bytes, mime);
        this.insertAttachment({
          id,
          kind: "image",
          name,
          mime,
          text: prompt,
          path,
          thumb_path: "",
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

  /* ------------------------------------------------------------------ usage -- */

  /** Token counts arrive per step; a turn's cost is their sum. */
  override onStepFinish(step: StepContext): void {
    const prompt = step.usage?.inputTokens ?? 0;
    const completion = step.usage?.outputTokens ?? 0;
    this.turnUsage.prompt += prompt;
    this.turnUsage.completion += completion;
    this.turnUsage.cost += this.priceOf(prompt, completion, openrouterCost(step));
  }

  /**
   * The turn is over: bank what it spent against the assistant message Think just
   * wrote, and name the session if this was its first exchange.
   */
  override async onChatResponse(result: {
    message: UIMessage;
    status: "completed" | "error" | "aborted";
  }): Promise<void> {
    this.ensureSchema();
    this.exec(
      `INSERT OR REPLACE INTO usage (message_id, prompt_tokens, completion_tokens, cost_usd, ms, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
      result.message.id,
      this.turnUsage.prompt,
      this.turnUsage.completion,
      this.turnUsage.cost,
      this.turnUsage.started ? Date.now() - this.turnUsage.started : 0,
      Date.now()
    );

    const messages = await this.getMessages();
    const questions = messages.filter((m) => m.role === "user");
    if (questions.length === 1 && result.status === "completed") {
      await this.nameSession(textOf(questions[0]), textOf(result.message));
    }
  }

  private priceOf(promptTokens: number, completionTokens: number, reported?: number) {
    if (typeof reported === "number") return reported;
    const p = MODEL_FALLBACK_PRICE[this.model()];
    return p ? promptTokens * p.prompt + completionTokens * p.completion : 0;
  }

  /**
   * Ask the model for a short name for the session and write it to the registry, so
   * the sidebar stops showing "New session". Best effort: a failed title must never
   * fail the turn it was generated from.
   */
  private async nameSession(userMessage: string, reply: string) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model(),
          messages: [
            { role: "system", content: TITLE_PROMPT },
            { role: "user", content: `User: ${userMessage}\n\nAssistant: ${reply.slice(0, 500)}` },
          ],
        }),
      });
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

  /* ----------------------------------------------------------------- routes -- */

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
      const { message, retry } = (await request.json()) as {
        message?: string;
        retry?: boolean;
      };
      if (message === undefined) {
        return Response.json({ error: "body must be { message: string }" }, { status: 400 });
      }
      return await this.streamChat(message, retry === true);
    }

    // Attachment bytes are served raw so an <img> src can point straight at them.
    if (request.method === "GET" && path === "files" && route[1]) {
      return route[2] === "thumb"
        ? await this.serveThumbnail(route[1])
        : await this.serveAttachment(route[1]);
    }

    let body: unknown;
    let status = 200;
    let turn: Record<string, unknown> | undefined;

    try {
      if (request.method === "POST" && path === "chat") {
        const result = await this.runChat(((await request.json()) as { message: string }).message);
        body = result.body;
        turn = result.turn;
      } else if (request.method === "POST" && path === "files") {
        const result = await this.upload(request);
        body = result.body;
        status = result.status;
      } else if (request.method === "GET" && path === "files") {
        body = { attachments: this.pendingAttachments().map(publicAttachment) };
      } else if (request.method === "DELETE" && path === "files" && route[1]) {
        await this.removeAttachment(route[1]);
        body = { ok: true };
      } else if (request.method === "GET" && path === "tasks") {
        body = { tasks: this.listTasks() };
      } else if (request.method === "DELETE" && path === "tasks" && route[1]) {
        body = { ok: await this.cancelTask(route[1]) };
      } else if (request.method === "GET" && path === "messages") {
        body = { messages: await this.transcript() };
      } else if (request.method === "GET" && path === "export") {
        body = await this.exportTurns(Number(url.searchParams.get("count") ?? "0"));
      } else if (request.method === "POST" && path === "import") {
        await this.importTurns((await request.json()) as Snapshot);
        body = { ok: true };
      } else if (request.method === "GET" && path === "summary") {
        body = await this.summary();
      } else if (request.method === "POST" && path === "reset") {
        await this.reset();
        body = { ok: true };
      } else if (request.method === "POST" && path === "telegram") {
        body = await this.telegramTurn((await request.json()) as TelegramMessage);
      } else if (request.method === "POST" && path === "destroy") {
        // The bucket is swept before the reply, because `destroy()` aborts the
        // isolate: work left running behind it may never finish. Dropping the
        // object's own storage is what waits, and the runtime completes that.
        await this.sweepBucket();
        this.ctx.waitUntil(this.destroy());
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

  private insertAttachment(row: Omit<Attachment, "ts" | "used">): Attachment {
    const full: Attachment = { ...row, ts: Date.now(), used: 0 };
    this.exec(
      `INSERT INTO attachments (id, kind, name, mime, text, path, thumb_path, bytes, ts, used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      full.id,
      full.kind,
      full.name,
      full.mime,
      full.text,
      full.path,
      full.thumb_path,
      full.bytes,
      full.ts
    );
    return full;
  }

  /** Only an unsent attachment can be dropped; a sent one belongs to its message. */
  private async removeAttachment(id: string) {
    const row = this.attachment(id);
    if (!row || row.used === 1) return;
    this.exec(`DELETE FROM attachments WHERE id = ? AND used = 0`, id);
    if (row.path) await this.workspace.rm(`uploads/${id}`, { recursive: true, force: true });
  }

  private async serveAttachment(id: string): Promise<Response> {
    const row = this.attachment(id);
    if (!row?.path) return new Response("not found", { status: 404 });
    const stream = await this.workspace.readFileStream(row.path);
    if (!stream) return new Response("not found", { status: 404 });
    return new Response(stream, {
      headers: {
        "content-type": row.mime,
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }

  private async serveThumbnail(id: string): Promise<Response> {
    const row = this.attachment(id);
    if (!row?.thumb_path) return new Response("not found", { status: 404 });
    const stream = await this.workspace.readFileStream(row.thumb_path);
    if (!stream) return new Response("not found", { status: 404 });
    return new Response(stream, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
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
    const path = uploadPath(id, file.name);

    const limit = isPdf(mime, file.name)
      ? MAX_UPLOAD_BYTES.pdf
      : mime.startsWith("image/")
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

    if (isPdf(mime, file.name)) {
      if (!enabled(config, "file_ingest")) {
        return { body: { error: "File ingest is off. Turn it on under Capabilities." }, status: 400 };
      }
      // Nothing is extracted here: the file lands in the workspace whole, and the
      // read tool hands its pages to the model when a question needs them. The card's
      // first-page image is rendered by the browser and arrives beside the file.
      await this.workspace.writeFileBytes(path, await file.arrayBuffer(), "application/pdf");
      const attachment = this.insertAttachment({
        id,
        kind: "pdf",
        name: file.name,
        mime: "application/pdf",
        text: "",
        path,
        thumb_path: await this.putThumbnail(id, form.get("thumbnail")),
        bytes: file.size,
      });
      return { body: { attachment: publicAttachment(attachment) }, status: 200 };
    }

    if (mime.startsWith("image/")) {
      if (!enabled(config, "vision")) {
        return { body: { error: "Image input is off. Turn it on under Capabilities." }, status: 400 };
      }
      // Refuse here rather than at turn time: by the time the model refuses, the
      // message and the attachment have already been stored.
      if (!modelSeesImages(config.model)) {
        return {
          body: {
            error: `${config.model} cannot see images. Pick a multimodal model under Settings.`,
          },
          status: 400,
        };
      }
      await this.workspace.writeFileBytes(path, await file.arrayBuffer(), mime);
      const attachment = this.insertAttachment({
        id,
        kind: "image",
        name: file.name,
        mime,
        text: "",
        path,
        thumb_path: "",
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
      await this.workspace.writeFileBytes(path, await file.arrayBuffer(), mime);
      const attachment = this.insertAttachment({
        id,
        kind: "text",
        name: file.name,
        mime,
        text: "",
        path,
        thumb_path: "",
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
    const text = await file.text();
    await this.workspace.writeFile(path, text, mime);
    const attachment = this.insertAttachment({
      id,
      kind: "text",
      name: file.name,
      mime,
      text,
      path,
      thumb_path: "",
      bytes: file.size,
    });
    return { body: { attachment: publicAttachment(attachment) }, status: 200 };
  }

  /**
   * Store the PNG of a PDF's first page. The browser renders it, so a malformed or
   * oversized image is dropped rather than trusted: the card falls back to its name.
   */
  private async putThumbnail(id: string, thumbnail: unknown): Promise<string> {
    const file = thumbnail as File | null;
    if (!file || typeof file === "string" || file.size === 0) return "";
    if (file.size > MAX_THUMBNAIL_BYTES) return "";
    const path = `uploads/${id}/thumb.png`;
    await this.workspace.writeFileBytes(path, await file.arrayBuffer(), "image/png");
    return path;
  }

  /**
   * Turn audio into text. OpenRouter has no /audio/transcriptions route, but many of
   * its models take audio as a chat input part, so this spends the key the Worker
   * already holds rather than asking the user for a second provider.
   */
  private async transcribe(bytes: ArrayBuffer, mime: string, name: string): Promise<string> {
    const format = audioFormat(mime, name);
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
              { type: "input_audio", input_audio: { data: bytesToBase64(bytes), format } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`transcription ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return (json.choices?.[0]?.message?.content ?? "").trim();
  }

  /**
   * Transcribe a stored clip on demand, and cache the words on its row so a second
   * call — or a reopened session — does not pay for the same audio twice.
   */
  private async transcribeAttachment(id: string): Promise<string> {
    const row = this.attachment(id);
    if (!row) return `No attachment with id ${id}.`;
    if (!isAudioAttachment(row)) return `${row.name} is not audio.`;
    if (row.text.trim()) return row.text;
    if (!enabled(this.config(), "audio_input")) {
      return "Audio input is off. Turn it on under Capabilities.";
    }
    const bytes = row.path ? await this.workspace.readFileBytes(row.path) : null;
    if (!bytes) return `The bytes for ${row.name} are gone.`;
    const transcript = await this.transcribe(toArrayBuffer(bytes), row.mime, row.name);
    this.exec(`UPDATE attachments SET text = ? WHERE id = ?`, transcript, id);
    return transcript;
  }

  /* ------------------------------------------------------------------ turns -- */

  /**
   * The user's turn: their words, plus a note naming every file they attached and
   * where it sits in the workspace. The bytes are not inlined — the model opens what
   * it needs with the read tool, so a PDF is not re-sent with every later message.
   */
  private userText(message: string, attachments: Attachment[]): string {
    if (attachments.length === 0) return message;
    const notes = attachments.map((a) => {
      if (isAudioAttachment(a)) {
        return a.text.trim()
          ? `--- attached audio: ${a.name} (id ${a.id}), already transcribed ---\n${a.text}`
          : `--- attached audio: ${a.name} (id ${a.id}), not transcribed. Call transcribe_audio with attachment_id "${a.id}" if you need the words. ---`;
      }
      // Images and PDFs ride along as content parts, so naming them is enough. A text
      // file is not sent: the model opens it from the workspace when it needs to.
      if (a.kind === "image") return `--- attached image: ${a.name} ---`;
      if (a.kind === "pdf") return `--- attached PDF: ${a.name} ---`;
      return `--- attached file: ${a.name}, in the workspace at ${a.path} ---`;
    });
    return [message, ...notes].filter((part) => part.trim() !== "").join("\n\n");
  }

  /**
   * The message a turn sends, and the files it claims: the pending ones, or — on a
   * retry — the ones the question being asked again came with.
   */
  private async openTurn(message: string, retry: boolean): Promise<UIMessage> {
    const attachments = retry ? await this.rewind() : this.pendingAttachments();
    const id = crypto.randomUUID();
    for (const a of attachments) {
      this.exec(`UPDATE attachments SET used = 1 WHERE id = ?`, a.id);
      this.exec(
        `INSERT OR REPLACE INTO message_files (message_id, attachment_id) VALUES (?, ?)`,
        id,
        a.id
      );
    }
    // The user row exists only for its timestamp; the reply's row carries the cost.
    this.exec(`INSERT OR REPLACE INTO usage (message_id, ts) VALUES (?, ?)`, id, Date.now());
    this.exec(`INSERT OR REPLACE INTO message_text (message_id, text) VALUES (?, ?)`, id, message);
    return {
      id,
      role: "user",
      parts: [{ type: "text", text: this.userText(message, attachments) }],
    };
  }

  /**
   * Undo the last exchange so it can be asked again: the trailing assistant messages
   * and the question that prompted them are deleted from the session, and that
   * question's attachments are handed back so the retry carries the same files.
   */
  private async rewind(): Promise<Attachment[]> {
    const messages = await this.getMessages();
    let cut = messages.length;
    while (cut > 0 && messages[cut - 1].role === "assistant") cut--;
    const question = cut > 0 && messages[cut - 1].role === "user" ? messages[cut - 1] : null;
    if (question) cut--;

    // Read the links before the rows go: the question's own row is among the ones
    // about to be deleted, and its files are exactly what the retry needs back.
    const attachments = question ? this.attachmentsOf(question.id) : [];

    const dropped = messages.slice(cut);
    if (dropped.length > 0) await this.session.deleteMessages(dropped.map((m) => m.id));
    for (const message of dropped) {
      this.exec(`DELETE FROM usage WHERE message_id = ?`, message.id);
      this.exec(`DELETE FROM message_files WHERE message_id = ?`, message.id);
      this.exec(`DELETE FROM message_text WHERE message_id = ?`, message.id);
    }
    // They are already marked used, so `pendingAttachments` would never find them.
    for (const a of attachments) this.exec(`UPDATE attachments SET used = 0 WHERE id = ?`, a.id);
    return attachments;
  }

  /** A whole turn, without streaming. */
  private async runChat(message: string, retry = false) {
    const userMessage = await this.openTurn(message, retry);
    const result = await this.runTurn({ input: [userMessage] });
    const reply =
      result.status === "completed" ? textOf(result.message as unknown as UIMessage) : "";
    const usage = this.exec<{ cost_usd: number; ms: number }>(
      `SELECT cost_usd, ms FROM usage WHERE message_id = ?`,
      result.message?.id ?? ""
    )[0];

    return {
      body: { reply },
      turn: { cost_usd: usage?.cost_usd ?? 0, llm_ms: usage?.ms ?? 0 },
    };
  }

  /**
   * Stream a reply as SSE, in the event shape the browser already speaks. Think owns
   * the loop and the persistence; this translates its UI message chunks into the
   * `delta` / `tool` / `tool_done` / `usage` protocol the chat client reads.
   *
   * The object stays resident — and billable — for the whole stream. A stopped reply
   * keeps its partial text and its token cost, because the tokens were generated.
   */
  private async streamChat(message: string, retry = false): Promise<Response> {
    const userMessage = await this.openTurn(message, retry);
    const encoder = new TextEncoder();
    const self = this;
    // Tool events name the call by id; the name arrives once, when it starts.
    const toolNames = new Map<string, string>();

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // The client is gone. The turn still finishes, and is still persisted.
          }
        };

        try {
          await self.runTurn({
            mode: "stream",
            input: [userMessage],
            callback: {
              onStart() {},
              onEvent(json: string) {
                const chunk = JSON.parse(json) as {
                  type: string;
                  delta?: string;
                  toolCallId?: string;
                  toolName?: string;
                };
                if (chunk.type === "text-delta" && chunk.delta) {
                  send({ type: "delta", text: chunk.delta });
                } else if (chunk.type === "tool-input-start" && chunk.toolCallId) {
                  toolNames.set(chunk.toolCallId, chunk.toolName ?? "tool");
                  send({ type: "tool", name: chunk.toolName ?? "tool" });
                } else if (chunk.type === "tool-output-available" && chunk.toolCallId) {
                  send({ type: "tool_done", name: toolNames.get(chunk.toolCallId) ?? "tool", ok: true });
                } else if (chunk.type === "tool-output-error" && chunk.toolCallId) {
                  send({ type: "tool_done", name: toolNames.get(chunk.toolCallId) ?? "tool", ok: false });
                }
              },
              onDone() {},
              onError(error: string) {
                send({ type: "error", error });
              },
            },
          });

          send({
            type: "usage",
            prompt_tokens: self.turnUsage.prompt,
            completion_tokens: self.turnUsage.completion,
            cost_usd: self.turnUsage.cost,
            llm_ms: self.turnUsage.started ? Date.now() - self.turnUsage.started : 0,
          });
        } catch (err) {
          send({ type: "error", error: err instanceof Error ? err.message : String(err) });
        }
        controller.close();
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

  /* --------------------------------------------------------------- telegram -- */

  /**
   * One message from Telegram, answered. The chat is a session like any other, so the
   * turn is the same turn the browser runs: the same settings, tools, memory and
   * transcript. What is different is the ends — the files arrive from Telegram rather
   * than from an upload, and the reply is posted back rather than streamed.
   */
  private async telegramTurn(message: TelegramMessage): Promise<{ ok: boolean; skipped?: string }> {
    const config = this.config();
    if (!enabled(config, "telegram")) return { ok: false, skipped: "telegram is off" };
    if (!addressesBot(message, config.telegram_bot_username)) {
      // A group message that does not name the bot is not for it.
      return { ok: true, skipped: "not addressed" };
    }

    const bot = new Telegram(config.telegram_bot_token, this.env.TELEGRAM_API_BASE);
    const chatId = String(message.chat.id);
    await bot.typing(chatId);

    try {
      await this.ingestTelegramFiles(bot, message);
      const text = messageTextWithQuote(message) || "(no text)";
      const drawnBefore = new Set(this.exec<{ id: string }>(`SELECT id FROM attachments`).map((r) => r.id));

      const result = await this.runTurn({ input: [await this.openTurn(text, false)] });
      const reply =
        result.status === "completed"
          ? textOf(result.message as unknown as UIMessage)
          : "That turn did not finish. Try again?";

      await bot.send(chatId, reply || "(no reply)", message.message_id);
      // An image the agent drew during the turn is a file, not a link, in a chat.
      await this.sendDrawnImages(bot, chatId, drawnBefore);
      return { ok: true };
    } catch (err) {
      await bot
        .send(chatId, `Something went wrong: ${err instanceof Error ? err.message : String(err)}`)
        .catch(() => {
          // The chat is unreachable; the error is already the answer to the request.
        });
      return { ok: false };
    }
  }

  /**
   * Pull what the message carried into the workspace, as though it had been uploaded:
   * the same rows, the same paths, the same capability checks, so the turn that
   * follows cannot tell the difference.
   */
  private async ingestTelegramFiles(bot: Telegram, message: TelegramMessage): Promise<void> {
    const config = this.config();
    for (const file of messageFiles(message)) {
      const isImage = file.mime.startsWith("image/");
      const isAudio = file.mime.startsWith("audio/") || file.mime.startsWith("video/");
      const allowed = isImage
        ? enabled(config, "vision") && modelSeesImages(config.model)
        : isAudio
          ? enabled(config, "audio_input")
          : enabled(config, "file_ingest");
      if (!allowed) continue;

      const bytes = await bot.download(file.file_id);
      const id = crypto.randomUUID().slice(0, 12);
      const path = uploadPath(id, file.name);
      await this.workspace.writeFileBytes(path, bytes, file.mime);
      const pdf = isPdf(file.mime, file.name);
      const textual = !isImage && !isAudio && !pdf;
      this.insertAttachment({
        id,
        kind: isImage ? "image" : pdf ? "pdf" : "text",
        name: file.name,
        mime: file.mime,
        text: textual ? new TextDecoder().decode(bytes).slice(0, MAX_UPLOAD_BYTES.text) : "",
        path,
        thumb_path: "",
        bytes: bytes.byteLength,
      });
    }
  }

  /** Images created during this turn, sent to the chat as photos. */
  private async sendDrawnImages(bot: Telegram, chatId: string, before: Set<string>): Promise<void> {
    const drawn = this.exec<Attachment>(
      `SELECT * FROM attachments WHERE kind = 'image' ORDER BY ts ASC`
    ).filter((a) => !before.has(a.id));
    for (const image of drawn) {
      const bytes = await this.workspace.readFileBytes(image.path);
      if (!bytes) continue;
      await bot.sendPhoto(chatId, toArrayBuffer(bytes), image.name, image.text);
    }
  }

  /* ------------------------------------------------------------- transcript -- */

  /**
   * The transcript as the API serves it: Think's messages, plus what only this agent
   * knows — the files each question carried, and what each reply cost.
   */
  private async transcript(): Promise<StoredMessage[]> {
    const messages = await this.getMessages();
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const usage = this.exec<{
          prompt_tokens: number;
          completion_tokens: number;
          cost_usd: number;
          ms: number;
          ts: number;
        }>(`SELECT * FROM usage WHERE message_id = ?`, m.id)[0];
        const steps = stepsOf(m);
        const toolLines = steps.some((s) => s.kind === "tools");
        return {
          id: m.id,
          role: m.role as "user" | "assistant",
          content: this.spokenText(m),
          ts: usage?.ts ?? 0,
          prompt_tokens: usage?.prompt_tokens ?? 0,
          completion_tokens: usage?.completion_tokens ?? 0,
          cost_usd: usage?.cost_usd ?? 0,
          ms: usage?.ms ?? 0,
          attachments: this.attachmentsOf(m.id).map(publicAttachment),
          steps: toolLines ? JSON.stringify(steps) : "[]",
        };
      });
  }

  /**
   * What the message said, as a person wrote it: the file annotations the turn added
   * for the model are dropped, so the bubble and a forked draft read the way they did
   * when they were typed.
   */
  private spokenText(message: UIMessage): string {
    const typed = this.exec<{ text: string }>(
      `SELECT text FROM message_text WHERE message_id = ?`,
      message.id
    )[0];
    return typed ? typed.text : textOf(message);
  }

  private attachmentsOf(messageId: string): Attachment[] {
    return this.exec<{ attachment_id: string }>(
      `SELECT attachment_id FROM message_files WHERE message_id = ?`,
      messageId
    )
      .map((row) => this.attachment(row.attachment_id))
      .filter((a): a is Attachment => !!a);
  }

  /* ---------------------------------------------------------------- forking -- */

  /**
   * The first `count` messages with every attachment they reference, bytes included,
   * so the fork can stand on its own.
   */
  private async exportTurns(count: number): Promise<Snapshot> {
    const visible = (await this.getMessages()).filter(
      (m) => m.role === "user" || m.role === "assistant"
    );
    const kept = visible.slice(0, Math.max(0, count));
    const keep = new Set(kept.map((m) => m.id));

    const pack = async (ids: string[]): Promise<PackedAttachment[]> =>
      await Promise.all(
        ids
          .map((id) => this.attachment(id))
          .filter((a): a is Attachment => !!a)
          .map(async (a) => ({
            ...a,
            data: await this.readBase64(a.path),
            thumb: await this.readBase64(a.thumb_path),
          }))
      );

    const carried = kept.flatMap((m) => this.attachmentsOf(m.id).map((a) => a.id));
    // The message just past the cut is the question a fork hands back for editing;
    // its files travel too, so the new session's composer opens with the same chips.
    const dropped = visible[Math.max(0, count)];
    const pending =
      dropped?.role === "user" ? this.attachmentsOf(dropped.id).map((a) => a.id) : [];

    return {
      messages: (await this.getMessages()).filter((m) => keep.has(m.id)),
      attachments: await pack(carried),
      links: this.exec<{ message_id: string; attachment_id: string }>(
        `SELECT message_id, attachment_id FROM message_files`
      ).filter((row) => keep.has(row.message_id)),
      texts: this.exec<{ message_id: string; text: string }>(
        `SELECT message_id, text FROM message_text`
      ).filter((row) => keep.has(row.message_id)),
      pending: await pack(pending),
    };
  }

  private async readBase64(path: string): Promise<string> {
    if (!path) return "";
    const bytes = await this.workspace.readFileBytes(path);
    return bytes ? bytesToBase64(toArrayBuffer(bytes)) : "";
  }

  /**
   * Replay a snapshot into this (empty) session. Attachment ids are kept, so the
   * copied messages still name their files, but the bytes are written into this
   * session's own workspace so deleting either side leaves the other intact.
   */
  private async importTurns(snapshot: Snapshot): Promise<void> {
    const carried = (snapshot.attachments ?? []).map((a) => [a, 1] as const);
    // Copied unsent (used = 0), so they show as chips and ride the next turn.
    const pending = (snapshot.pending ?? []).map((a) => [a, 0] as const);

    for (const [a, used] of [...carried, ...pending]) {
      let path = "";
      if (a.data) {
        path = uploadPath(a.id, a.name);
        await this.workspace.writeFileBytes(path, base64ToBytes(a.data), a.mime);
      }
      // The first-page image is copied the same way: a fork that lost its thumbnails
      // would redraw every PDF card as a bare name.
      let thumb = "";
      if (a.thumb) {
        thumb = `uploads/${a.id}/thumb.png`;
        await this.workspace.writeFileBytes(thumb, base64ToBytes(a.thumb), "image/png");
      }
      this.exec(
        `INSERT OR REPLACE INTO attachments (id, kind, name, mime, text, path, thumb_path, bytes, ts, used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        a.id,
        a.kind,
        a.name,
        a.mime,
        a.text,
        path,
        thumb,
        a.bytes,
        a.ts,
        used
      );
    }

    const messages = snapshot.messages ?? [];
    if (messages.length > 0) await this.addMessages(messages);

    // Ids are preserved across the copy, so which question carried which file — and
    // what each question actually said — travels as its own rows.
    for (const link of snapshot.links ?? []) {
      this.exec(
        `INSERT OR REPLACE INTO message_files (message_id, attachment_id) VALUES (?, ?)`,
        link.message_id,
        link.attachment_id
      );
    }
    for (const row of snapshot.texts ?? []) {
      this.exec(
        `INSERT OR REPLACE INTO message_text (message_id, text) VALUES (?, ?)`,
        row.message_id,
        row.text
      );
    }
  }

  /**
   * Every object this session spilled into the bucket. It is swept by key prefix
   * rather than by what the workspace remembers, so a row lost to a failed write or
   * an interrupted delete cannot leave its bytes behind for good.
   */
  private async sweepBucket(): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await this.env.FILES.list({ prefix: `${this.name}/`, cursor });
      // R2 takes up to 1000 keys per delete call, and a page holds at most 1000.
      if (page.objects.length > 0) {
        await this.env.FILES.delete(page.objects.map((o) => o.key));
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  /** Clear the session in place: transcript, files, and pending tasks. */
  private async reset(): Promise<void> {
    await this.session.clearMessages();
    this.exec(`DELETE FROM usage`);
    this.exec(`DELETE FROM message_files`);
    this.exec(`DELETE FROM message_text`);
    this.exec(`DELETE FROM attachments`);
    await this.workspace.rm("uploads", { recursive: true, force: true });
    // Anything the model wrote for itself goes too, bytes in the bucket included.
    for (const entry of await this.workspace.readDir("/")) {
      await this.workspace.rm(entry.path, { recursive: true, force: true });
    }
    for (const task of this.listTasks()) await this.cancelTask(task.id);
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

  /**
   * The user's scheduled prompts. Think keeps schedules of its own — recovery and
   * turn continuations — so only this agent's own callback is listed.
   */
  private listTasks(): ScheduledTask[] {
    return [...this.getSchedules<{ prompt: string }>()]
      .filter((s) => s.callback === "runScheduledTask")
      .map(describeSchedule);
  }

  private async cancelTask(id: string): Promise<boolean> {
    return await this.cancelSchedule(id);
  }

  /**
   * A scheduled task runs a turn with nobody watching: the prompt is stored as the
   * user message and the reply lands in the transcript, so the session reads as a
   * conversation when the user comes back to it. It is submitted rather than awaited,
   * because an alarm has nowhere to stream to and a submission survives a restart.
   */
  async runScheduledTask(payload: { prompt: string }) {
    this.ensureSchema();
    await this.loadConfig();
    await this.runTurn({
      mode: "submit",
      input: [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: `[scheduled task] ${payload.prompt}` }],
        },
      ],
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
  private async summary() {
    const row = this.exec<{ prompt: number; completion: number; cost: number }>(
      `SELECT COALESCE(SUM(prompt_tokens), 0) AS prompt,
              COALESCE(SUM(completion_tokens), 0) AS completion,
              COALESCE(SUM(cost_usd), 0) AS cost
       FROM usage`
    )[0];
    const messages = await this.getMessages();

    return {
      session: this.name,
      messages: messages.filter((m) => m.role === "user" || m.role === "assistant").length,
      llm: {
        model: this.model(),
        prompt_tokens: row?.prompt ?? 0,
        completion_tokens: row?.completion ?? 0,
        cost_usd: row?.cost ?? 0,
      },
      tasks: this.listTasks(),
      sqlite_bytes: this.ctx.storage.sql.databaseSize,
      // Facets keep their own storage, which the object's own destroy does not
      // reach. Nothing here creates one; this is the tripwire if that changes.
      sub_agents: this.listSubAgents().length,
    };
  }
}

/* ---------------------------------------------------------------------- utils -- */

function isAudioAttachment(a: Attachment): boolean {
  return a.mime.startsWith("audio/") || a.mime.startsWith("video/");
}

/** A PDF by mime, or by name when the browser sends no type at all. */
function isPdf(mime: string, name: string): boolean {
  return mime === "application/pdf" || /\.pdf$/i.test(name);
}

/** Attachment rows carry a whole file; the API sends everything except the bytes. */
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
    /** Whether a first-page image exists to draw on the file card. */
    thumb: a.thumb_path !== "",
  };
}

/** Every text part of a message, joined — what the transcript API calls its content. */
function textOf(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * How a turn unfolded, read back off the message Think stored: text it wrote, and the
 * tools it ran between writing. A tool part carries its own outcome, so a failed tool
 * still draws as a failed line when the session is reopened.
 */
function stepsOf(message: UIMessage): TurnStep[] {
  const steps: TurnStep[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      const last = steps[steps.length - 1];
      if (last?.kind === "text") last.text += part.text;
      else steps.push({ kind: "text", text: part.text });
      continue;
    }
    if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") continue;
    const called = part as { type: string; toolName?: string; state?: string };
    const name = called.toolName ?? called.type.replace(/^tool-/, "");
    const ok = called.state !== "output-error";
    const last = steps[steps.length - 1];
    if (last?.kind === "tools") last.tools.push({ name, ok });
    else steps.push({ kind: "tools", tools: [{ name, ok }] });
  }
  return steps;
}

/**
 * OpenRouter reports the exact dollar cost of a call, and the AI SDK passes the raw
 * usage object through untouched, which is where it lands.
 */
function openrouterCost(step: StepContext): number | undefined {
  const raw = (step.usage as { raw?: Record<string, unknown> } | undefined)?.raw;
  const cost = raw?.cost;
  return typeof cost === "number" ? cost : undefined;
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
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
