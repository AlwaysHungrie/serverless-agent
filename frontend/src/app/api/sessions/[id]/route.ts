import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  return proxy(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  return proxy(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}
