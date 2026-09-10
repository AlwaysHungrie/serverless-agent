import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ agentId: string; id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { agentId, id } = await params;
  return proxy(`/api/agents/${encodeURIComponent(agentId)}/mcp/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { agentId, id } = await params;
  return proxy(`/api/agents/${encodeURIComponent(agentId)}/mcp/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
