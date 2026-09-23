import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** One fleet's settings, and the catalogues the dialog that edits them picks from. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fleetId: string }> },
) {
  const { fleetId } = await params;
  return proxy(`/api/fleets/${encodeURIComponent(fleetId)}`);
}

/**
 * Save the fleet's settings and write them over one batch of its agents. The body
 * carries the cursor, so the caller keeps asking until the Worker says it is done.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ fleetId: string }> },
) {
  const { fleetId } = await params;
  return proxy(`/api/fleets/${encodeURIComponent(fleetId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
