#!/usr/bin/env node
/**
 * Ask a deployed Worker whether it actually works.
 *   node scripts/smoke.mjs --url https://salt-agent-staging.<subdomain>.workers.dev
 *
 * Run this after a deploy, against the deployment that just went live. Preflight
 * checks what is configured *before* the deploy; this checks what happened *after*,
 * which is the only question that catches a migration that throws, a binding that is
 * missing, or a Worker that came up refusing to serve.
 *
 * The important check is the second one. `GET /` is answered by the Worker alone and
 * proves only that code is live. `GET /api/admin/stats` goes through the identity gate
 * and into `AgentDirectory`, which opens its SQLite and runs its migration ladder — so
 * a schema step that throws shows up here as a failed smoke test on a staging
 * deployment, rather than as a 500 for whoever touches production first.
 *
 * `API_SECRET` comes from the environment, or from `.dev.vars` when the target is the
 * local dev server. It is never printed. For a real staging run, pass it in:
 *
 *     API_SECRET=... npm run smoke:staging
 *
 * Exit status is what matters: 0 means the deployment answered, non-zero means roll
 * back (`npx wrangler rollback --env <name>`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const urlIndex = process.argv.indexOf("--url");
const base = (urlIndex === -1 ? process.env.SMOKE_URL : process.argv[urlIndex + 1])?.replace(
  /\/$/,
  ""
);

if (!base) {
  console.error(
    "\n  Nothing to smoke-test.\n\n" +
      "  Pass the deployment to check:\n\n" +
      "      node scripts/smoke.mjs --url https://salt-agent-staging.<subdomain>.workers.dev\n"
  );
  process.exit(1);
}

/** `API_SECRET`, from the environment or — for a local target — from `.dev.vars`. */
function apiSecret() {
  if (process.env.API_SECRET) return process.env.API_SECRET;
  if (!/localhost|127\.0\.0\.1/.test(base)) return null;
  try {
    const line = readFileSync(join(root, ".dev.vars"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("API_SECRET="));
    return line ? line.slice("API_SECRET=".length).trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

const failures = [];

/**
 * Run a check, retrying briefly before calling it a failure.
 *
 * A workers.dev route takes a few seconds to answer after a deploy, and this script
 * runs immediately after one. Without this, the first attempt gets Cloudflare's own
 * 404 page rather than the Worker, and a healthy deployment reports as broken — which
 * would teach whoever is on call to ignore this script, the worst outcome available.
 */
async function check(name, run) {
  const deadline = Date.now() + 30_000;
  let last;
  for (let attempt = 1; ; attempt++) {
    try {
      await run();
      console.log(`  ok    ${name}${attempt > 1 ? ` (after ${attempt} attempts)` : ""}`);
      return;
    } catch (err) {
      last = err;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  console.log(`  FAIL  ${name}`);
  failures.push(`${name}: ${last instanceof Error ? last.message : String(last)}`);
}

/** Fetch with a deadline, so a hung deployment fails the smoke instead of hanging it. */
async function get(path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
  const body = await res.text();
  if (!res.ok) {
    // The body is the Worker's own explanation — `unconfigured()` in server.ts says
    // exactly what is missing — so it is worth carrying into the failure.
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  return body;
}

console.log(`\n  smoke ${base}\n`);

// The Worker is live and serving. Nothing touches storage yet.
await check("GET / — worker is serving", async () => {
  const body = await get("/");
  const json = JSON.parse(body);
  if (!json.routes) throw new Error("no route listing in the response");
});

// The path that opens a Durable Object and runs its migrations.
const secret = apiSecret();
if (!secret) {
  console.log("  skip  GET /api/admin/stats — no API_SECRET in the environment");
  console.log(
    "\n  Storage was not exercised. Set API_SECRET to make this smoke test mean\n" +
      "  something: without it the only thing checked is that the Worker is up.\n"
  );
} else {
  await check("GET /api/admin/stats — directory storage and migrations", async () => {
    const body = await get("/api/admin/stats", { "x-api-secret": secret });
    JSON.parse(body);
  });
}

if (failures.length > 0) {
  console.error(`\n  ${failures.length} check(s) failed:\n`);
  for (const f of failures) console.error(`    ${f}`);
  console.error(`\n  Roll back: npx wrangler rollback --env <name>\n`);
  process.exit(1);
}

console.log("\n  smoke ok\n");
