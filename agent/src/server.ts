import { routeAgentRequest } from "agents";
import { MODELS, type Env } from "./agent";
import { Telegram, allowedBy, chatTitle, topicId, type TelegramUpdate } from "./telegram";
import {
  CAPABILITIES,
  SECRET_MASK,
  TELEGRAM_WHITELIST_DEFAULTS,
  type CapabilityField,
} from "./capabilities";
import type { Config } from "./registry";

export { SessionAgent } from "./agent";
export { SessionRegistry } from "./registry";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,PATCH,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function registry(env: Env) {
  return env.SessionRegistry.get(env.SessionRegistry.idFromName("global"));
}

/**
 * The session a Telegram conversation maps to. A DM is one chat, a group is another,
 * and a forum topic is its own conversation inside a group — so this is what gives
 * each of them its own session, and keeps giving it the same one.
 */
function sessionIdForChat(chatId: string, threadId = ""): string {
  const base = `tg-${chatId.replace("-", "n")}`;
  return threadId ? `${base}-t${threadId}` : base;
}

/**
 * A session id for a chat that has none. Normally that is just the chat's own id, but
 * `!new` leaves the previous session in place under exactly that name — so a
 * generation is appended until the name is free. Without this the "new" session would
 * be the old Durable Object again, which is the one thing it must not be.
 */
async function freeSessionId(
  reg: ReturnType<typeof registry>,
  chatId: string,
  threadId: string
): Promise<string> {
  const base = sessionIdForChat(chatId, threadId);
  if (!(await reg.get(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-g${n}`;
    if (!(await reg.get(candidate))) return candidate;
  }
  // A thousand fresh starts in one chat is not a thing; fall back to a unique name.
  return `${base}-g${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * The webhook's shared secret. Telegram echoes it on every call, and it is derived
 * from the bot token so there is nothing extra for anyone to store or paste.
 */
async function webhookSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function withCors(res: Response) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

const REASONING_EFFORTS = ["off", "low", "medium", "high"] as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Every capability toggle, and every credential field any capability declares. */
const CAPABILITY_FLAGS = CAPABILITIES.map((c) => c.flag);
const CAPABILITY_FIELDS: CapabilityField[] = CAPABILITIES.flatMap((c) => c.fields);

/**
 * Keep the settings row trustworthy: the agent reads it straight into an OpenRouter
 * request, so every value is checked and clamped here rather than at the call site.
 * Only the keys actually present are returned, so a PATCH stays a partial update.
 */
function validateConfig(body: Partial<Config>): Partial<Config> {
  const patch: Partial<Config> = {};

  if (body.model !== undefined) {
    if (!MODELS.some((m) => m.id === body.model)) throw new Error(`unknown model: ${body.model}`);
    patch.model = body.model;
  }
  if (body.system_prompt !== undefined) {
    if (typeof body.system_prompt !== "string") throw new Error("system_prompt must be a string");
    patch.system_prompt = body.system_prompt.slice(0, 4000);
  }
  if (body.temperature !== undefined) {
    if (!Number.isFinite(body.temperature)) throw new Error("temperature must be a number");
    patch.temperature = clamp(body.temperature, 0, 2);
  }
  if (body.max_tokens !== undefined) {
    if (!Number.isFinite(body.max_tokens)) throw new Error("max_tokens must be a number");
    patch.max_tokens = Math.round(clamp(body.max_tokens, 0, 32000));
  }
  if (body.reasoning_effort !== undefined) {
    if (!REASONING_EFFORTS.includes(body.reasoning_effort)) {
      throw new Error(`unknown reasoning effort: ${body.reasoning_effort}`);
    }
    patch.reasoning_effort = body.reasoning_effort;
  }
  if (body.context_messages !== undefined) {
    if (!Number.isFinite(body.context_messages)) throw new Error("context_messages must be a number");
    patch.context_messages = Math.round(clamp(body.context_messages, 0, 200));
  }

  for (const flag of CAPABILITY_FLAGS) {
    if (body[flag] !== undefined) (patch[flag] as number) = body[flag] ? 1 : 0;
  }

  for (const field of CAPABILITY_FIELDS) {
    const value = body[field.key];
    if (value === undefined) continue;
    if (typeof value !== "string") throw new Error(`${field.key} must be a string`);
    // The mask is what a secret reads back as, so it means "leave this one alone".
    if (field.secret && value === SECRET_MASK) continue;
    let cleaned = value.trim();
    // A Telegram handle is written with an @ everywhere it is shown, so the field
    // accepts one — but the stored form is bare: links and mention matching build
    // the @ back themselves.
    if (field.key === "telegram_bot_username") cleaned = cleaned.replace(/^@+/, "");
    // A list holds many entries, so it gets more room than a single credential.
    (patch[field.key] as string) = cleaned.slice(0, field.list ? 8000 : 1000);
  }

  return patch;
}

/** Config as the browser may see it: secrets become a mask, never the key itself. */
function redact(config: Config): Config {
  const safe = { ...config };
  for (const field of CAPABILITY_FIELDS) {
    if (!field.secret) continue;
    (safe[field.key] as string) = String(config[field.key] ?? "") ? SECRET_MASK : "";
  }
  return safe;
}

/**
 * Point the bot at this Worker, or unhook it when the capability is switched off.
 * Best effort: a bad token is reported back to the settings page, not thrown, because
 * the rest of the save has already happened.
 */
async function syncWebhook(
  config: Config,
  origin: string,
  api?: string
): Promise<{ ok: boolean; error?: string } | undefined> {
  if (!config.telegram_bot_token) return undefined;
  const bot = new Telegram(config.telegram_bot_token, api);
  try {
    if (config.cap_telegram) {
      await bot.setWebhook(`${origin}/telegram/webhook`, await webhookSecret(config.telegram_bot_token));
    } else {
      await bot.deleteWebhook();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * One Telegram update. The chat is resolved to its session — created on first
 * contact — and the message is handed to that session's own agent, which answers in
 * the chat itself. Telegram retries anything that is not a fast 200, so the turn runs
 * after the response rather than under it.
 */
async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const reg = registry(env);
  const config = await reg.config(env.MODEL);
  if (!config.cap_telegram || !config.telegram_bot_token) {
    return new Response("telegram is off", { status: 404 });
  }
  const offered = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (offered !== (await webhookSecret(config.telegram_bot_token))) {
    return new Response("bad secret", { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const message = update?.message;
  // Edits are ignored: answering them again would double every correction.
  if (!message?.chat) return new Response("ok");

  const chatId = String(message.chat.id);
  // A forum topic is a conversation of its own, so it keys a session of its own.
  const topic = topicId(message);
  const threadId = topic ? String(topic) : "";

  // The whitelists, when filled in, decide who gets an answer: a DM is judged by who
  // sent it, a group by which group — and which topic of it — the message is in. An
  // update from anywhere else is dropped silently, before a session exists for it.
  const allowed =
    message.chat.type === "private"
      ? allowedBy(config.telegram_user_whitelist, [
          message.from?.username,
          message.from?.id !== undefined ? String(message.from.id) : undefined,
        ])
      : allowedBy(config.telegram_group_whitelist, [
          threadId ? `${chatId}:${threadId}` : chatId,
          chatId,
          message.chat.username,
        ]);
  if (!allowed) return new Response("ok");

  const existing = await reg.forChat(chatId, threadId);
  const sessionId = existing?.id ?? (await freeSessionId(reg, chatId, threadId));
  if (!existing) {
    await reg.create(sessionId, chatTitle(message), env.SessionAgent.idFromName(sessionId).toString(), {
      source: "telegram",
      chat_id: chatId,
      chat_type: message.chat.type,
      // A public group links by handle; a private one links by its internal id.
      chat_username: message.chat.type === "private" ? "" : (message.chat.username ?? ""),
      chat_thread_id: threadId,
    });
  }
  await reg.touch(sessionId);

  const url = new URL(request.url);
  const turn = routeAgentRequest(
    new Request(`${url.origin}/agents/session-agent/${sessionId}/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    }),
    env
  );
  // Telegram is told the update landed straight away; the answer arrives in the chat.
  ctx.waitUntil(turn);
  return new Response("ok", { headers: { "x-session": sessionId } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);

    // App settings live in the registry object, next to the session index.
    if (segments[0] === "api" && segments[1] === "config") {
      const reg = registry(env);
      if (request.method === "GET") {
        return withCors(
          Response.json({
            config: redact(await reg.config(env.MODEL)),
            models: MODELS,
            capabilities: CAPABILITIES,
          })
        );
      }
      if (request.method === "PATCH") {
        const body = (await request.json()) as Partial<Config>;
        let patch: Partial<Config>;
        try {
          patch = validateConfig(body);
        } catch (err) {
          return withCors(Response.json({ error: (err as Error).message }, { status: 400 }));
        }
        // Switching Telegram on with both whitelists empty would let all of Telegram
        // talk to the bot, so the first enable seeds them with entries that match
        // nothing. Only on the way on, and only over lists nobody has filled in.
        if (patch.cap_telegram === 1) {
          const current = await reg.config(env.MODEL);
          if (!current.cap_telegram) {
            for (const [key, value] of Object.entries(TELEGRAM_WHITELIST_DEFAULTS)) {
              const field = key as keyof typeof TELEGRAM_WHITELIST_DEFAULTS;
              if (patch[field] === undefined && current[field].trim() === "") {
                patch[field] = value;
              }
            }
          }
        }
        const config = await reg.setConfig(patch, env.MODEL);
        // Saving the token is the whole setup: the bot is pointed at this Worker here
        // rather than through a curl the user has to run by hand.
        const telegram = await syncWebhook(config, url.origin, env.TELEGRAM_API_BASE);
        return withCors(Response.json({ config: redact(config), ...(telegram ? { telegram } : {}) }));
      }
    }

    // "Why is the bot not answering?" — asked of Telegram itself.
    if (segments[0] === "api" && segments[1] === "telegram" && segments[2] === "status") {
      const config = await registry(env).config(env.MODEL);
      if (!config.telegram_bot_token) {
        return withCors(Response.json({ error: "no bot token saved" }, { status: 400 }));
      }
      const bot = new Telegram(config.telegram_bot_token, env.TELEGRAM_API_BASE);
      try {
        const [info, me] = await Promise.all([bot.webhookInfo(), bot.me()]);
        return withCors(
          Response.json({
            enabled: config.cap_telegram === 1,
            bot: me.username,
            expected: `${url.origin}/telegram/webhook`,
            webhook: info,
          })
        );
      } catch (err) {
        return withCors(
          Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
        );
      }
    }

    if (segments[0] === "api" && segments[1] === "sessions") {
      const reg = registry(env);
      const id = segments[2];

      if (request.method === "GET" && !id) {
        return withCors(Response.json({ sessions: await reg.list() }));
      }
      if (request.method === "POST" && !id) {
        const { id: wanted, title } = (await request.json().catch(() => ({}))) as {
          id?: string;
          title?: string;
        };
        const sessionId = wanted ?? crypto.randomUUID().slice(0, 8);
        // Record the object's hex id: it is the only way to attribute Cloudflare's
        // analytics back to a session. See docs/cloudflare-durable-object-costs.md.
        const objectId = env.SessionAgent.idFromName(sessionId).toString();
        return withCors(Response.json(await reg.create(sessionId, title ?? "New session", objectId)));
      }
      // Fork: a new session seeded with the first `count` messages of an existing one,
      // so a conversation can be branched without disturbing the original.
      if (request.method === "POST" && id && segments[3] === "fork") {
        const { count, title } = (await request.json().catch(() => ({}))) as {
          count?: number;
          title?: string;
        };
        const exported = await routeAgentRequest(
          new Request(
            `${url.origin}/agents/session-agent/${encodeURIComponent(id)}/export?count=${Number(count ?? 0)}`
          ),
          env
        );
        if (!exported?.ok) {
          return withCors(Response.json({ error: "could not read the source session" }, { status: 502 }));
        }
        const snapshot = await exported.text();

        const forkId = crypto.randomUUID().slice(0, 8);
        const objectId = env.SessionAgent.idFromName(forkId).toString();
        const source = (await reg.list()).find((s) => s.id === id);
        const row = await reg.create(
          forkId,
          title ?? `${source?.title ?? "Session"} (fork)`,
          objectId
        );
        const imported = await routeAgentRequest(
          new Request(`${url.origin}/agents/session-agent/${forkId}/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: snapshot,
          }),
          env
        );
        if (!imported?.ok) {
          await reg.remove(forkId);
          return withCors(Response.json({ error: "could not seed the fork" }, { status: 502 }));
        }
        return withCors(Response.json(row));
      }

      // A session whose turns stopped completing, freed without losing what it holds.
      if (request.method === "POST" && id && segments[3] === "unstick") {
        const freed = await routeAgentRequest(
          new Request(`${url.origin}/agents/session-agent/${encodeURIComponent(id)}/unstick`, {
            method: "POST",
          }),
          env
        );
        if (!freed?.ok) {
          return withCors(Response.json({ error: "could not reach that session" }, { status: 502 }));
        }
        return withCors(Response.json(await freed.json()));
      }

      if (request.method === "PATCH" && id) {
        const { title } = (await request.json()) as { title: string };
        await reg.rename(id, title);
        return withCors(Response.json({ ok: true }));
      }
      if (request.method === "DELETE" && id) {
        await reg.remove(id);
        // Destroy the object itself, not just its rows: a Durable Object is billed
        // for the bytes it stores, so a cleared-but-living session still costs.
        await routeAgentRequest(
          new Request(`${url.origin}/agents/session-agent/${id}/destroy`, { method: "POST" }),
          env
        ).catch(() => {
          // `destroy()` aborts the isolate, which can surface as a broken response.
        });
        return withCors(Response.json({ ok: true }));
      }
    }

    // Keep the sidebar ordered by recency without the frontend having to say so.
    if (segments[0] === "agents" && segments[1] === "session-agent" && segments[2]) {
      const last = segments[3];
      if (last === "stream" || last === "chat") {
        await registry(env).touch(segments[2]);
      }
    }

    // Telegram posts here. The secret token is what makes the call trustworthy, so a
    // request without it is refused before anything is read.
    if (request.method === "POST" && segments[0] === "telegram" && segments[1] === "webhook") {
      return await handleWebhook(request, env, ctx);
    }

    const routed = await routeAgentRequest(request, env);
    if (routed) return withCors(routed);

    if (url.pathname === "/") {
      return withCors(
        Response.json({
          routes: {
            sessions: "GET|POST /api/sessions, PATCH|DELETE /api/sessions/:id",
            fork: "POST /api/sessions/:id/fork  { count }",
            unstick: "POST /api/sessions/:id/unstick",
            config: "GET|PATCH /api/config",
            stream: "POST /agents/session-agent/:id/stream  { message }  -> SSE",
            chat: "POST /agents/session-agent/:id/chat  { message }",
            messages: "GET /agents/session-agent/:id/messages",
            files: "GET|POST /agents/session-agent/:id/files, GET|DELETE .../files/:fileId",
            tasks: "GET /agents/session-agent/:id/tasks, DELETE .../tasks/:taskId",
            metrics: "GET /agents/session-agent/:id/metrics",
            telegram: "POST /telegram/webhook",
          },
        })
      );
    }
    return withCors(Response.json({ error: "not found" }, { status: 404 }));
  },
};
