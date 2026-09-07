import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxy(`/agents/session-agent/${encodeURIComponent(id)}/messages`);
}
