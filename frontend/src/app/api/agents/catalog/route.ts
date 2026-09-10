import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** Models and capabilities, for the create dialog — before there is an agent. */
export async function GET() {
  return proxy("/api/agents/catalog");
}
