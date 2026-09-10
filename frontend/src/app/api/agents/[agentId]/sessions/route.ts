import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ agentId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { agentId } = await params;
  // `limit` and `cursor` page the session list; the agent owns what they mean.
  const query = new URL(request.url).searchParams.toString();
  return proxy(
    `/api/agents/${encodeURIComponent(agentId)}/sessions${query ? `?${query}` : ""}`
  );
}

export async function POST(request: Request, { params }: Ctx) {
  const { agentId } = await params;
  return proxy(`/api/agents/${encodeURIComponent(agentId)}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
