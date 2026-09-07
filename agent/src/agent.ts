import { Agent } from "agents";
import { estimateCost, sessionsIncludedPerMonth, MODEL_FALLBACK_PRICE, type UsageTotals } from "./pricing";
import type { SessionRegistry } from "./registry";

export type Env = {
  SessionAgent: DurableObjectNamespace;
  SessionRegistry: DurableObjectNamespace<SessionRegistry>;
  OPENROUTER_API_KEY: string;
  MODEL: string;
};

type Msg = { role: "user" | "assistant" | "system"; content: string };

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
         ts INTEGER NOT NULL,
         prompt_tokens INTEGER NOT NULL DEFAULT 0,
         completion_tokens INTEGER NOT NULL DEFAULT 0,
         cost_usd REAL NOT NULL DEFAULT 0,
         ms INTEGER NOT NULL DEFAULT 0
       )`
    );
    // Bring forward databases created before the per-message usage columns existed.
    for (const col of [
      "prompt_tokens INTEGER NOT NULL DEFAULT 0",
      "completion_tokens INTEGER NOT NULL DEFAULT 0",
      "cost_usd REAL NOT NULL DEFAULT 0",
      "ms INTEGER NOT NULL DEFAULT 0",
    ]) {
      try {
        this.exec(`ALTER TABLE messages ADD COLUMN ${col}`);
      } catch {
        // Column already present.
      }
    }
    // One row, one UPDATE per request. An earlier key/value shape cost six row
    // writes per request, which made the meter more expensive than the work it
    // was measuring.
    this.exec(
      `CREATE TABLE IF NOT EXISTS usage_totals (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         requests REAL NOT NULL DEFAULT 0,
         active_ms REAL NOT NULL DEFAULT 0,
         wall_clock_ms REAL NOT NULL DEFAULT 0,
         rows_read REAL NOT NULL DEFAULT 0,
         rows_written REAL NOT NULL DEFAULT 0,
         prompt_tokens REAL NOT NULL DEFAULT 0,
         completion_tokens REAL NOT NULL DEFAULT 0,
         llm_cost_usd REAL NOT NULL DEFAULT 0
       )`
    );
    this.exec(`INSERT OR IGNORE INTO usage_totals (id) VALUES (1)`);
    this.schemaReady = true;
  }

  /** Token and cost deltas for the current request, flushed with the counters. */
  private pending = { promptTokens: 0, completionTokens: 0, llmCostUsd: 0 };

  private counters(): Record<string, number> {
    return this.exec<Record<string, number>>(`SELECT * FROM usage_totals WHERE id = 1`)[0] ?? {};
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

  /**
   * Fold one request's resource use into the persisted counters.
   * `billableMs` is the wall clock Cloudflare would charge duration for, which for a
   * stream is the whole time the object stayed resident producing it.
   */
  private recordRequest(billableMs: number) {
    const instanceWallClock = Date.now() - this.instanceWokeAt;
    this.wallClockCheckpoint = instanceWallClock;

    // A single UPDATE, so metering costs one row write per request. That row cannot
    // count itself while it is being written, so the +1s below add the read and the
    // write this statement is about to perform.
    this.exec(
      `UPDATE usage_totals SET
         requests = requests + 1,
         active_ms = active_ms + ?,
         wall_clock_ms = wall_clock_ms + ?,
         rows_read = rows_read + ?,
         rows_written = rows_written + ?,
         prompt_tokens = prompt_tokens + ?,
         completion_tokens = completion_tokens + ?,
         llm_cost_usd = llm_cost_usd + ?
       WHERE id = 1`,
      billableMs,
      billableMs,
      this.rowsRead + 1,
      this.rowsWritten + 1,
      this.pending.promptTokens,
      this.pending.completionTokens,
      this.pending.llmCostUsd
    );
    this.pending = { promptTokens: 0, completionTokens: 0, llmCostUsd: 0 };
  }

  async onRequest(request: Request): Promise<Response> {
    const startedAt = Date.now();
    this.rowsRead = 0;
    this.rowsWritten = 0;
    this.ensureSchema();

    const url = new URL(request.url);
    const path = url.pathname.split("/").filter(Boolean).pop() ?? "";

    // Streaming owns its own metering: the object stays billable until the last token.
    if (request.method === "POST" && path === "stream") {
      const { message } = (await request.json()) as { message?: string };
      if (!message) return Response.json({ error: "body must be { message: string }" }, { status: 400 });
      return this.streamChat(message, startedAt);
    }

    let body: unknown;
    let status = 200;
    let turn: Record<string, unknown> | undefined;

    try {
      if (request.method === "POST" && path === "chat") {
        const result = await this.chat(((await request.json()) as { message: string }).message);
        body = result.body;
        turn = result.turn;
      } else if (request.method === "GET" && path === "messages") {
        body = { messages: this.messages() };
      } else if (request.method === "GET" && path === "metrics") {
        body = this.metrics();
      } else if (request.method === "POST" && path === "reset") {
        this.exec(`DELETE FROM messages`);
        this.exec(`UPDATE usage_totals SET requests = 0, active_ms = 0, wall_clock_ms = 0,
                     rows_read = 0, rows_written = 0, prompt_tokens = 0,
                     completion_tokens = 0, llm_cost_usd = 0 WHERE id = 1`);
        body = { ok: true };
      } else {
        status = 404;
        body = { error: `no route for ${request.method} ${url.pathname}` };
      }
    } catch (err) {
      status = 500;
      body = { error: err instanceof Error ? err.message : String(err) };
    }

    const activeMs = Date.now() - startedAt;
    this.recordRequest(activeMs);

    return Response.json(
      {
        ...(body as object),
        _meta: {
          session: this.name,
          request: {
            active_ms: activeMs,
            rows_read: this.rowsRead,
            rows_written: this.rowsWritten,
            storage_bytes: this.ctx.storage.sql.databaseSize,
            ...turn,
          },
        },
      },
      { status }
    );
  }

  private messages(): StoredMessage[] {
    return this.exec<StoredMessage>(
      `SELECT id, role, content, ts, prompt_tokens, completion_tokens, cost_usd, ms
       FROM messages ORDER BY id ASC`
    );
  }

  private history(): Msg[] {
    return this.exec<Msg>(`SELECT role, content FROM messages ORDER BY id ASC`);
  }

  private modelMessages(message: string): Msg[] {
    return [{ role: "system", content: SYSTEM_PROMPT }, ...this.history(), { role: "user", content: message }];
  }

  private priceOf(promptTokens: number, completionTokens: number, reported?: number) {
    if (typeof reported === "number") return reported;
    const p = MODEL_FALLBACK_PRICE[this.env.MODEL as keyof typeof MODEL_FALLBACK_PRICE];
    return p ? promptTokens * p.prompt + completionTokens * p.completion : 0;
  }

  private saveAssistant(content: string, promptTokens: number, completionTokens: number, cost: number, ms: number) {
    this.exec(
      `INSERT INTO messages (role, content, ts, prompt_tokens, completion_tokens, cost_usd, ms)
       VALUES ('assistant', ?, ?, ?, ?, ?, ?)`,
      content,
      Date.now(),
      promptTokens,
      completionTokens,
      cost,
      ms
    );
    this.pending.promptTokens += promptTokens;
    this.pending.completionTokens += completionTokens;
    this.pending.llmCostUsd += cost;
  }

  private openrouter(messages: Msg[], stream: boolean, signal?: AbortSignal) {
    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: this.env.MODEL, messages, stream, usage: { include: true } }),
      signal,
    });
  }

  private async chat(message: string) {
    const messages = this.modelMessages(message);
    this.exec(`INSERT INTO messages (role, content, ts) VALUES ('user', ?, ?)`, message, Date.now());

    const llmStart = Date.now();
    const res = await this.openrouter(messages, false);
    if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`);

    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
    };
    const llmMs = Date.now() - llmStart;
    const reply = json.choices[0]?.message?.content ?? "";
    const promptTokens = json.usage?.prompt_tokens ?? 0;
    const completionTokens = json.usage?.completion_tokens ?? 0;
    const cost = this.priceOf(promptTokens, completionTokens, json.usage?.cost);

    this.saveAssistant(reply, promptTokens, completionTokens, cost, llmMs);

    return {
      body: { reply },
      turn: { llm_ms: llmMs, prompt_tokens: promptTokens, completion_tokens: completionTokens, llm_cost_usd: cost },
    };
  }

  /**
   * Stream a reply as SSE. The object stays resident — and billable — for the whole
   * stream, so duration is metered when the stream ends, whether it completed or the
   * client stopped it. A stopped reply keeps its partial text and its token cost,
   * because OpenRouter has already generated (and charged for) what arrived.
   */
  private streamChat(message: string, startedAt: number): Response {
    const messages = this.modelMessages(message);
    this.exec(`INSERT INTO messages (role, content, ts) VALUES ('user', ?, ?)`, message, Date.now());
    const userMessageRowsWritten = this.rowsWritten;
    const userMessageRowsRead = this.rowsRead;

    const encoder = new TextEncoder();
    const upstream = new AbortController();
    const llmStart = Date.now();

    let text = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let reportedCost: number | undefined;
    let finished = false;

    const finish = (aborted: boolean) => {
      if (finished) return;
      finished = true;
      const llmMs = Date.now() - llmStart;
      const cost = this.priceOf(promptTokens, completionTokens, reportedCost);
      this.saveAssistant(text + (aborted ? "\n\n_(stopped)_" : ""), promptTokens, completionTokens, cost, llmMs);
      this.recordRequest(Date.now() - startedAt);
      return { cost, llmMs };
    };

    const self = this;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

        try {
          const res = await self.openrouter(messages, true, upstream.signal);
          if (!res.ok || !res.body) {
            send({ type: "error", error: `openrouter ${res.status}: ${await res.text()}` });
            finish(false);
            controller.close();
            return;
          }

          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
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
                choices?: { delta?: { content?: string } }[];
                usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
              };
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                text += delta;
                send({ type: "delta", text: delta });
              }
              if (chunk.usage) {
                promptTokens = chunk.usage.prompt_tokens;
                completionTokens = chunk.usage.completion_tokens;
                reportedCost = chunk.usage.cost;
              }
            }
          }

          const result = finish(false);
          send({
            type: "usage",
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            cost_usd: result?.cost ?? 0,
            llm_ms: result?.llmMs ?? 0,
            do_active_ms: Date.now() - startedAt,
            rows_read: self.rowsRead + userMessageRowsRead,
            rows_written: self.rowsWritten + userMessageRowsWritten,
            storage_bytes: self.ctx.storage.sql.databaseSize,
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
