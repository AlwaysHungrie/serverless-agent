import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/**
 * The actions forwarded to the Worker unchanged. An allowlist rather than a pass-
 * through, so a path this app does not know about never reaches the Worker — which
 * also means a route added there is a 404 here until it is named below.
 */
const ACTIONS = ["connect", "disconnect", "refresh", "recommend"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string; id: string; action: string }> },
) {
  const { agentId, id, action } = await params;
  if (!ACTIONS.includes(action)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return proxy(
    `/api/agents/${encodeURIComponent(agentId)}/mcp/${encodeURIComponent(id)}/${action}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
    },
  );
}
