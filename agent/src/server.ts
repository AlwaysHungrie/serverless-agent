import { routeAgentRequest } from "agents";
import type { Env } from "./agent";

export { SessionAgent } from "./agent";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/") {
      return Response.json({
        usage: {
          chat: "POST /agents/session-agent/<session-id>/chat  { \"message\": \"...\" }",
          history: "GET  /agents/session-agent/<session-id>/history",
          metrics: "GET  /agents/session-agent/<session-id>/metrics",
          reset: "POST /agents/session-agent/<session-id>/reset",
        },
      });
    }
    return (
      (await routeAgentRequest(request, env)) ??
      Response.json({ error: "not found" }, { status: 404 })
    );
  },
};
