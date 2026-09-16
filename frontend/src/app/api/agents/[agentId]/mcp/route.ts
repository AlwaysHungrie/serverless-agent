import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ agentId: string }> };

/**
 * The marker that says this call came from the meta settings dialog rather than from
 * the agent's own pages. The proxy builds its own upstream URL, so the flag has to be
 * carried across by hand or the Worker only ever sees the agent-page case.
 */
function managing(request: Request): string {
  return new URL(request.url).searchParams.get("meta") === "1" ? "?meta=1" : "";
}

export async function GET(_request: Request, { params }: Ctx) {
  const { agentId } = await params;
  return proxy(`/api/agents/${encodeURIComponent(agentId)}/mcp`);
}

export async function POST(request: Request, { params }: Ctx) {
  const { agentId } = await params;
  return proxy(
    `/api/agents/${encodeURIComponent(agentId)}/mcp${managing(request)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
    },
  );
}
