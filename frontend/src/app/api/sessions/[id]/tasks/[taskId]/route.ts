import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { id, taskId } = await params;
  return proxy(
    `/agents/session-agent/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" }
  );
}
