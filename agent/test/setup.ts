import { SELF, env } from "cloudflare:test";
import { beforeAll } from "vitest";
import { SHIPPED } from "./shipped";

/**
 * Every test file starts on a complete settings document. The Worker refuses to serve
 * without one, so a suite that did not seed it would be testing the refusal.
 *
 * Written through the route rather than the directory's RPC so the Worker's own
 * per-isolate cache is dropped along with it.
 */
beforeAll(async () => {
  const res = await SELF.fetch("https://worker.test/api/admin/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-api-secret": env.API_SECRET as string },
    body: JSON.stringify(SHIPPED),
  });
  if (!res.ok) throw new Error(`could not seed deployment settings: ${await res.text()}`);
});
