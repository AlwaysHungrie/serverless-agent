import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** File a request to raise the caller's own agent limit. */
export async function POST(request: Request) {
  return proxy("/api/business-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
