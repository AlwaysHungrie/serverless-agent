import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // `limit` and `before` page the transcript backwards from its end; both are passed
  // straight through, so the agent stays the only place the window is decided.
  const query = new URL(request.url).searchParams.toString();
  return proxy(
    `/agents/session-agent/${encodeURIComponent(id)}/messages${query ? `?${query}` : ""}`
  );
}
