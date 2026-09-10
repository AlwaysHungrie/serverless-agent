import { AGENT_URL } from "./agent";
import { agentHeaders } from "./upstream";

/**
 * Forward a request to the agent Worker and hand its response back unchanged.
 *
 * If the Worker is not running, this returns a JSON 502 rather than throwing, so the
 * browser gets a readable message instead of trying to parse an empty error body.
 */
export async function proxy(path: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(`${AGENT_URL}${path}`, {
      cache: "no-store",
      ...init,
      headers: { ...(init?.headers as Record<string, string>), ...(await agentHeaders()) },
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const cause = err instanceof Error && err.cause ? ` (${String(err.cause)})` : "";
    return Response.json(
      {
        error: `Cannot reach the Agent at ${AGENT_URL} ${cause}`,
      },
      { status: 502 }
    );
  }
}
