import { Agent } from "agents";
import { estimateCost, sessionsIncludedPerMonth, MODEL_FALLBACK_PRICE, type UsageTotals } from "./pricing";

export type Env = {
  SessionAgent: DurableObjectNamespace;
  OPENROUTER_API_KEY: string;
  MODEL: string;
};

type Msg = { role: "user" | "assistant" | "system"; content: string };

const SYSTEM_PROMPT = "You are a concise assistant running inside a Cloudflare Durable Object.";

/**
 * One Durable Object instance == one agent session.
 * The instance name in the URL (/agents/session-agent/<session-id>) is the session id.
 */
export class SessionAgent extends Agent<Env> {
  /** Wall clock at the moment this DO instance woke into memory. */
  private instanceWokeAt = Date.now();
  /** Wall-clock milliseconds of this instance already folded into the stored total. */
  private wallClockCheckpoint = 0;
  /** Row counters for the current request, filled by exec(). */
  private rowsRead = 0;
  private rowsWritten = 0;
  private schemaReady = false;

  /** Run SQL and accumulate the row counters Cloudflare bills on. */
  private exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): T[] {
    const cursor = this.ctx.storage.sql.exec(query, ...(bindings as never[]));
    const rows = cursor.toArray() as T[];
    this.rowsRead += cursor.rowsRead;
    this.rowsWritten += cursor.rowsWritten;
    return rows;
  }

  private ensureSchema() {
    if (this.schemaReady) return;
    this.exec(
      `CREATE TABLE IF NOT EXISTS messages (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         role TEXT NOT NULL,
         content TEXT NOT NULL,
         ts INTEGER NOT NULL
       )`
    );
    this.exec(
      `CREATE TABLE IF NOT EXISTS usage (
         k TEXT PRIMARY KEY,
         v REAL NOT NULL DEFAULT 0
       )`
    );
    this.schemaReady = true;
  }

  private bump(key: string, delta: number) {
    if (delta === 0) return;
    this.exec(
      `INSERT INTO usage (k, v) VALUES (?, ?)
       ON CONFLICT(k) DO UPDATE SET v = v + excluded.v`,
      key,
      delta
    );
  }

  private counters(): Record<string, number> {
    const rows = this.exec<{ k: string; v: number }>(`SELECT k, v FROM usage`);
    return Object.fromEntries(rows.map((r) => [r.k, r.v]));
  }

  private totals(): UsageTotals {
    const c = this.counters();
    return {
      requests: c.requests ?? 0,
      activeMs: c.active_ms ?? 0,
      wallClockMs: c.wall_clock_ms ?? 0,
      rowsRead: c.rows_read ?? 0,
      rowsWritten: c.rows_written ?? 0,
      storageBytes: this.ctx.storage.sql.databaseSize,
      promptTokens: c.prompt_tokens ?? 0,
      completionTokens: c.completion_tokens ?? 0,
      llmCostUsd: c.llm_cost_usd ?? 0,
    };
  }

  async onRequest(request: Request): Promise<Response> {
    const startedAt = Date.now();
    this.rowsRead = 0;
    this.rowsWritten = 0;
    this.ensureSchema();

    const url = new URL(request.url);
    const path = url.pathname.split("/").filter(Boolean).pop() ?? "";

    let body: unknown;
    let status = 200;
    let turn: Record<string, unknown> | undefined;

    try {
      if (request.method === "POST" && path === "chat") {
        const { message } = (await request.json()) as { message?: string };
        if (!message) {
          return Response.json({ error: "body must be { message: string }" }, { status: 400 });
        }
        const result = await this.chat(message);
        body = result.body;
        turn = result.turn;
      } else if (request.method === "GET" && path === "history") {
        body = { messages: this.history() };
      } else if (request.method === "GET" && path === "metrics") {
        body = this.metrics();
      } else if (request.method === "POST" && path === "reset") {
        this.exec(`DELETE FROM messages`);
        this.exec(`DELETE FROM usage`);
        body = { ok: true };
      } else {
        status = 404;
        body = { error: `no route for ${request.method} ${url.pathname}` };
      }
    } catch (err) {
      status = 500;
      body = { error: err instanceof Error ? err.message : String(err) };
    }

    // Fold this request's resource use into the persisted counters. The write
    // itself is counted too, so the numbers are self-inclusive rather than low.
    const activeMs = Date.now() - startedAt;
    const instanceWallClock = Date.now() - this.instanceWokeAt;
    const wallClockDelta = instanceWallClock - this.wallClockCheckpoint;
    this.wallClockCheckpoint = instanceWallClock;

    const readsBefore = this.rowsRead;
    const writesBefore = this.rowsWritten;
    this.bump("requests", 1);
    this.bump("active_ms", activeMs);
    this.bump("wall_clock_ms", wallClockDelta);
    this.bump("rows_read", readsBefore);
    this.bump("rows_written", writesBefore);
    // Account for the metering writes themselves on the next request.
    this.bump("rows_read", this.rowsRead - readsBefore);
    this.bump("rows_written", this.rowsWritten - writesBefore);

    const meta = {
      session: this.name,
      request: {
        active_ms: activeMs,
        instance_wall_clock_ms: instanceWallClock,
        rows_read: this.rowsRead,
        rows_written: this.rowsWritten,
        storage_bytes: this.ctx.storage.sql.databaseSize,
        ...turn,
      },
    };

    return Response.json({ ...(body as object), _meta: meta }, { status });
  }

  private history(): Msg[] {
    return this.exec<Msg>(`SELECT role, content FROM messages ORDER BY id ASC`);
  }

  private async chat(message: string) {
    const history = this.history();
    this.exec(`INSERT INTO messages (role, content, ts) VALUES (?, ?, ?)`, "user", message, Date.now());

    const messages: Msg[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message },
    ];

    const llmStart = Date.now();
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: this.env.MODEL, messages, usage: { include: true } }),
    });

    if (!res.ok) {
      throw new Error(`openrouter ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
    };
    const llmMs = Date.now() - llmStart;
    const reply = json.choices[0]?.message?.content ?? "";

    this.exec(`INSERT INTO messages (role, content, ts) VALUES (?, ?, ?)`, "assistant", reply, Date.now());

    const promptTokens = json.usage?.prompt_tokens ?? 0;
    const completionTokens = json.usage?.completion_tokens ?? 0;
    const fallback = MODEL_FALLBACK_PRICE[this.env.MODEL as keyof typeof MODEL_FALLBACK_PRICE];
    const llmCost =
      json.usage?.cost ??
      (fallback ? promptTokens * fallback.prompt + completionTokens * fallback.completion : 0);

    this.bump("prompt_tokens", promptTokens);
    this.bump("completion_tokens", completionTokens);
    this.bump("llm_cost_usd", llmCost);

    return {
      body: { reply },
      turn: {
        llm_ms: llmMs,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        llm_cost_usd: llmCost,
      },
    };
  }

  private metrics() {
    const totals = this.totals();
    const messageCount = this.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM messages`)[0]?.n ?? 0;
    return {
      session: this.name,
      messages: messageCount,
      usage: {
        do_requests: totals.requests,
        do_handler_active_ms: totals.activeMs,
        do_wall_clock_ms: totals.wallClockMs,
        do_rows_read: totals.rowsRead,
        do_rows_written: totals.rowsWritten,
        sqlite_bytes: totals.storageBytes,
        prompt_tokens: totals.promptTokens,
        completion_tokens: totals.completionTokens,
      },
      cost: estimateCost(totals, this.env.MODEL),
      capacity: sessionsIncludedPerMonth(totals),
    };
  }
}
