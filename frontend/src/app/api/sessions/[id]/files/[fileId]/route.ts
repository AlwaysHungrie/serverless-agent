import { proxy } from "@/lib/proxy";
import { AGENT_URL } from "@/lib/agent";
import { agentHeaders } from "@/lib/upstream";

export const dynamic = "force-dynamic";

/** Image bytes, streamed through as-is so an <img src> can point at this route. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await params;
  const res = await fetch(
    `${AGENT_URL}/agents/session-agent/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
    { headers: await agentHeaders() }
  );
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await params;
  return proxy(
    `/agents/session-agent/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE" }
  );
}
