import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxy("/api/mcp");
}

export async function POST(request: Request) {
  return proxy("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
