import { AGENT_URL } from "./agent";

/**
 * Forward a request to the agent Worker and hand its response back unchanged.
 *
 * If the Worker is not running, this returns a JSON 502 rather than throwing, so the
 * browser gets a readable message instead of trying to parse an empty error body.
 */
export async function proxy(path: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(`${AGENT_URL}${path}`, { cache: "no-store", ...init });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const cause = err instanceof Error && err.cause ? ` (${String(err.cause)})` : "";
    return Response.json(
      {
        error: `Cannot reach the agent Worker at ${AGENT_URL}${cause}. Start it with \`pnpm dev\` in the agent/ directory, or point AGENT_URL at wherever it is listening.`,
      },
      { status: 502 }
    );
  }
}
