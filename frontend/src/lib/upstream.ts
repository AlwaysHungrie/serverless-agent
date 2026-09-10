import "server-only";
import { currentUser } from "@clerk/nextjs/server";

/**
 * What every server-to-Worker call has to carry.
 *
 * The secret says the call came from this app rather than from someone poking at the
 * Worker directly; the address says who it is being made for. The Worker checks that
 * address against the agent's access list, so this is the one place a signed-in user
 * is turned into authority — which is why it reads the session from Clerk itself
 * instead of taking an address from a caller who might have got it from a request
 * body.
 *
 * It lives apart from `lib/agent.ts` because that module is imported by client
 * components, and Clerk's `currentUser` may only be reached from the server.
 */
export async function agentHeaders(): Promise<Record<string, string>> {
  const secret = process.env.API_SECRET ?? "";
  const user = await currentUser().catch(() => null);
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  return {
    ...(secret ? { "x-api-secret": secret } : {}),
    ...(email ? { "x-user-email": email } : {}),
  };
}
