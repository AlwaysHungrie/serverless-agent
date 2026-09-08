import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxy(`/api/sessions/${encodeURIComponent(id)}/fork`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
