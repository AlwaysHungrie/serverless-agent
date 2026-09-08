import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxy("/api/config");
}

export async function PATCH(request: Request) {
  return proxy("/api/config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
