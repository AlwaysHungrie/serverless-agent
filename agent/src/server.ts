import { routeAgentRequest } from "agents";
import { MODELS, type Env } from "./agent";
import { CAPABILITIES, SECRET_MASK, type CapabilityField } from "./capabilities";
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
    (patch[field.key] as string) = value.trim().slice(0, 1000);
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
        return withCors(Response.json({ config: redact(await reg.setConfig(patch, env.MODEL)) }));
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

      if (request.method === "PATCH" && id) {
        const { title } = (await request.json()) as { title: string };
        await reg.rename(id, title);
        return withCors(Response.json({ ok: true }));
      }
      if (request.method === "DELETE" && id) {
        await reg.remove(id);
        // Drop the session's own Durable Object storage too.
        await routeAgentRequest(
          new Request(`${url.origin}/agents/session-agent/${id}/reset`, { method: "POST" }),
          env
        );
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

    const routed = await routeAgentRequest(request, env);
    if (routed) return withCors(routed);

    if (url.pathname === "/") {
      return withCors(
        Response.json({
          routes: {
            sessions: "GET|POST /api/sessions, PATCH|DELETE /api/sessions/:id",
            fork: "POST /api/sessions/:id/fork  { count }",
            config: "GET|PATCH /api/config",
            stream: "POST /agents/session-agent/:id/stream  { message }  -> SSE",
            chat: "POST /agents/session-agent/:id/chat  { message }",
            messages: "GET /agents/session-agent/:id/messages",
            files: "GET|POST /agents/session-agent/:id/files, GET|DELETE .../files/:fileId",
            tasks: "GET /agents/session-agent/:id/tasks, DELETE .../tasks/:taskId",
            metrics: "GET /agents/session-agent/:id/metrics",
          },
        })
      );
    }
    return withCors(Response.json({ error: "not found" }, { status: 404 }));
  },
};
