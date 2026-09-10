import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ agentId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { agentId } = await params;
  return proxy(`/api/agents/${encodeURIComponent(agentId)}/mcp`);
}

export async function POST(request: Request, { params }: Ctx) {
  const { agentId } = await params;
  return proxy(`/api/agents/${encodeURIComponent(agentId)}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
