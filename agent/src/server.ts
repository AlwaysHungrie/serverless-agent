import { routeAgentRequest } from "agents";
import type { Env } from "./agent";

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);

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
        return withCors(Response.json(await reg.create(sessionId, title ?? "New session")));
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
            stream: "POST /agents/session-agent/:id/stream  { message }  -> SSE",
            chat: "POST /agents/session-agent/:id/chat  { message }",
            messages: "GET /agents/session-agent/:id/messages",
            metrics: "GET /agents/session-agent/:id/metrics",
          },
        })
      );
    }
    return withCors(Response.json({ error: "not found" }, { status: 404 }));
  },
};
