import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** Real Durable Object usage from Cloudflare's analytics, for a deployed Worker. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const days = new URL(request.url).searchParams.get("days") ?? "1";
  return proxy(`/api/sessions/${encodeURIComponent(id)}/usage?days=${encodeURIComponent(days)}`);
}
