import { AGENT_URL } from "@/lib/agent";
import { agentHeaders } from "@/lib/upstream";

export const dynamic = "force-dynamic";

/** A PDF's first page, rendered at upload time and streamed through for the card. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const res = await fetch(
    `${AGENT_URL}/agents/session-agent/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}/thumb`,
    { headers: await agentHeaders() },
  );
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/png",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
