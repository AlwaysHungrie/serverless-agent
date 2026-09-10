import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** Every agent this deployment holds. */
export async function GET() {
  return proxy("/api/agents");
}

export async function POST(request: Request) {
  return proxy("/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
