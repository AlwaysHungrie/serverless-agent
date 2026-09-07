import { AGENT_URL } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch(`${AGENT_URL}/api/sessions`, { cache: "no-store" });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}

export async function POST(request: Request) {
  const res = await fetch(`${AGENT_URL}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}
