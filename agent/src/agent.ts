import { Agent } from "agents";
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

/** Fallback per-token pricing, used when OpenRouter does not return a cost. */
const MODEL_FALLBACK_PRICE: Record<string, { prompt: number; completion: number }> = {
  "deepseek/deepseek-v4-flash": { prompt: 0.000000088606, completion: 0.000000177212 },
};

const SYSTEM_PROMPT = "You are a concise assistant running inside a Cloudflare Durable Object.";

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
    this.schemaReady = true;
  }

  async onRequest(request: Request): Promise<Response> {
    this.ensureSchema();

    const url = new URL(request.url);
    const path = url.pathname.split("/").filter(Boolean).pop() ?? "";

    // Streaming owns its own metering: the object stays billable until the last token.
    if (request.method === "POST" && path === "stream") {
      const { message } = (await request.json()) as { message?: string };
      if (!message) return Response.json({ error: "body must be { message: string }" }, { status: 400 });
      return this.streamChat(message);
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
      } else if (request.method === "GET" && path === "summary") {
        body = this.summary();
      } else if (request.method === "POST" && path === "reset") {
        this.exec(`DELETE FROM messages`);
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
    const p = MODEL_FALLBACK_PRICE[this.env.MODEL];
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
  private streamChat(message: string): Response {
    const messages = this.modelMessages(message);
    this.exec(`INSERT INTO messages (role, content, ts) VALUES ('user', ?, ?)`, message, Date.now());

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
        model: this.env.MODEL,
        prompt_tokens: row?.prompt ?? 0,
        completion_tokens: row?.completion ?? 0,
        cost_usd: row?.cost ?? 0,
      },
      sqlite_bytes: this.ctx.storage.sql.databaseSize,
    };
  }
}
