import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** Add agents to a fleet: one per address, holding the fleet's own settings. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ fleetId: string }> },
) {
  const { fleetId } = await params;
  return proxy(`/api/fleets/${encodeURIComponent(fleetId)}/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
