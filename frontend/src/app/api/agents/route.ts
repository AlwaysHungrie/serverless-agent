import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/**
 * A page of the caller's agents, plus the fleets they administer.
 *
 * The query travels with it — `limit`, `cursor`, and `fleet` for one fleet's own
 * page — because an account that sponsors a fleet has more agents than any one
 * response should carry.
 */
export async function GET(request: Request) {
  const search = new URL(request.url).search;
  return proxy(`/api/agents${search}`);
}

export async function POST(request: Request) {
  return proxy("/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}

/**
 * One batch of a fleet's teardown — `?fleet=<id>&limit=<n>`.
 *
 * A fleet is deleted a few agents at a time and the caller keeps asking, so this
 * forwards the query and hands back what the Worker reports: how many went, and how
 * many are left.
 */
export async function DELETE(request: Request) {
  const search = new URL(request.url).search;
  return proxy(`/api/agents${search}`, { method: "DELETE" });
}
