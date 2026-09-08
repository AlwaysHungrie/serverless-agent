import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** The tasks this session has scheduled for itself. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxy(`/agents/session-agent/${encodeURIComponent(id)}/tasks`);
}
