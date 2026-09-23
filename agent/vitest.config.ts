import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { openrouterMock } from "./test/openrouter-mock";

/**
 * Tests run inside workerd, not Node.
 *
 * This is the only way the suite can mean anything here. Almost everything worth
 * testing in this Worker is a Durable Object holding its own SQLite: the migration
 * ladder, the access checks, the agent ceiling, the session index. Mocking that away
 * would leave tests that pass against a fake and say nothing about the thing that
 * ships. `@cloudflare/vitest-pool-workers` runs each test file in the real runtime,
 * with the real bindings from wrangler.jsonc — real DO storage, real SQL, real
 * `crypto.subtle` — so a test that passes here is a statement about production.
 *
 * Storage is not rolled back between tests in this version of the pool, so tests make
 * their own accounts and agents rather than sharing fixtures.
 */
export default defineConfig({
  test: {
    // Turn tests drive the real AI SDK client, which retries a 5xx with exponential
    // backoff before giving up. The default 5s expires mid-backoff and reports a
    // timeout rather than the refusal the test is actually about.
    //
    // Set well above what a turn needs, not close to it. This suite is the deploy
    // gate, and a gate that fails intermittently under load teaches people to re-run
    // it until it passes — which is the same as not having one. A slow test costs
    // seconds; a flaky one costs the gate its authority.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // The pool ships its own workerd, and it is behind the compatibility date in
        // wrangler.jsonc — workerd refuses to start on a date it does not know. This
        // pins the tests to the newest date the bundled binary supports rather than
        // dragging production back to it.
        //
        // It is a real gap: the suite runs on slightly older runtime semantics than
        // the deployment does. Raise this to match wrangler.jsonc whenever
        // `@cloudflare/vitest-pool-workers` ships a newer workerd.
        compatibilityDate: "2026-08-22",
        compatibilityFlags: ["nodejs_compat"],
        // `API_SECRET` is the owner's back door, and it is unset in wrangler.jsonc
        // because it is a secret. The owner-only routes are unreachable without one,
        // so the suite sets one — including for the tests that assert it stays shut
        // for everyone who does not present it. `CLERK_ISSUER` comes from the config's
        // own `vars`, which is what production reads too.
        bindings: { API_SECRET: "test-secret" },
        // Every outbound `fetch` from the Worker and from its Durable Objects, routed
        // to a fake OpenRouter. This is what makes the turn loop testable: the real
        // agent, the real AI SDK client and the real transcript writes all run, with
        // only the provider replaced. See test/openrouter-mock.ts.
        //
        // It also seals the suite off from the network — any other host gets a 503 —
        // so a test can never depend on someone else's service being up, and a
        // Telegram webhook sync can never fire at a real bot during a test run.
        outboundService: openrouterMock,
      },
    }),
  ],
});
