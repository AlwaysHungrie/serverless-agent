import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** connect, disconnect and refresh, forwarded to the Worker unchanged. */
const ACTIONS = ["connect", "disconnect", "refresh"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ACTIONS.includes(action)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return proxy(`/api/mcp/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
