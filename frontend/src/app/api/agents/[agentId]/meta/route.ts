import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ agentId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { agentId } = await params;
  return proxy(`/api/agents/${encodeURIComponent(agentId)}/meta`);
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { agentId } = await params;
  return proxy(`/api/agents/${encodeURIComponent(agentId)}/meta`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}

/** Push the stored defaults onto the agent's live settings. */
export async function POST(_request: Request, { params }: Ctx) {
  const { agentId } = await params;
  return proxy(`/api/agents/${encodeURIComponent(agentId)}/meta`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}
