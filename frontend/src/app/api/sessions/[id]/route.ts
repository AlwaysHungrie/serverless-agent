import { AGENT_URL } from "@/lib/agent";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await fetch(`${AGENT_URL}/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await fetch(`${AGENT_URL}/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}
