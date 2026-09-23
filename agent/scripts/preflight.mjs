#!/usr/bin/env node
/**
 * Refuse to deploy a Worker that would come up unguarded.
 *   node scripts/preflight.mjs [--env <name>]
 *
 * Runs ahead of `wrangler deploy`, because the version that matters is the one that
 * is already live. The Worker itself also refuses to serve without `API_SECRET` — see
 * `unconfigured()` in src/server.ts — so a deploy that slipped past this would fail
 * closed rather than open. This is the earlier and friendlier of the two: it says what
 * is missing before the broken version is the one answering.
 *
 * Secrets are not readable, only listable, which is all this needs: the question is
 * whether one is set, never what it is.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Which deployment this is about. Secrets are per-environment on Cloudflare, so
 * checking production's secrets before a staging deploy would be checking the wrong
 * Worker — and would pass while staging came up with nothing set.
 */
const envIndex = process.argv.indexOf("--env");
const targetEnv = envIndex === -1 ? null : process.argv[envIndex + 1];
const envArgs = targetEnv ? ["--env", targetEnv] : [];
const label = targetEnv ?? "production";

/** Every secret name the deployed Worker has, according to Cloudflare. */
function deployedSecrets() {
  try {
    const out = execFileSync("npx", ["wrangler", "secret", "list", ...envArgs], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Wrangler prints a banner before the JSON on some versions; take the array.
    const start = out.indexOf("[");
    if (start === -1) return null;
    return JSON.parse(out.slice(start)).map((s) => s.name);
  } catch {
    // No network, not logged in, or the Worker has never been deployed. Unknown is
    // not "fine": a preflight that passes when it could not check is worse than none.
    return null;
  }
}

/**
 * `vars` from wrangler.jsonc. JSONC, so the comments have to come out first — crude,
 * but this only ever reads a file in this repo written by this repo.
 */
function configuredVars() {
  const raw = readFileSync(join(root, "wrangler.jsonc"), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const config = JSON.parse(raw);
  // `vars` are not inherited by a named environment — Wrangler replaces the block
  // rather than merging it — so an environment's own block is the whole truth about
  // what it will come up holding.
  return (targetEnv ? config.env?.[targetEnv]?.vars : config.vars) ?? {};
}

const fail = (lines) => {
  console.error(`\n  Refusing to deploy to ${label}.\n\n${lines.map((l) => `  ${l}`).join("\n")}\n`);
  process.exit(1);
};

const secrets = deployedSecrets();
if (secrets === null) {
  fail([
    "Could not read the deployed Worker's secrets, so there is no way to tell",
    "whether API_SECRET is set on it.",
    "",
    `Check \`npx wrangler whoami\`, then run \`npx wrangler secret list${targetEnv ? ` --env ${targetEnv}` : ""}\``,
    "to see the real error. If this Worker has never been deployed, set its",
    "secrets first:",
    "",
    `    npx wrangler secret put API_SECRET${targetEnv ? ` --env ${targetEnv}` : ""}`,
  ]);
}

const vars = configuredVars();
if (!vars.CLERK_ISSUER && !secrets.includes("CLERK_ISSUER")) {
  fail([
    "CLERK_ISSUER is not set.",
    "",
    "It is what lets the Worker verify a Clerk session token, and a verified token",
    "is how every ordinary caller becomes somebody. Without it nobody can sign in",
    "to this deployment at all — the Worker refuses to serve rather than fall back",
    "to the API_SECRET back door as its only identity.",
    "",
    "Add it to `vars` in wrangler.jsonc — it is a public URL, not a secret:",
    "",
    '    "CLERK_ISSUER": "https://<subdomain>.clerk.accounts.dev"',
  ]);
}

// API_SECRET is optional now: it is the impersonation back door, not the gate, so a
// deployment without one is a deployment with one fewer way in. Worth saying out loud
// on the way past, because a live back door is not something to ship unnoticed.
console.log(
  secrets.includes("API_SECRET")
    ? `  preflight ok (${label}) — CLERK_ISSUER configured. API_SECRET is set: the\n  impersonation back door is live on this deployment.`
    : `  preflight ok (${label}) — CLERK_ISSUER configured. No API_SECRET: no\n  impersonation door.`
);
