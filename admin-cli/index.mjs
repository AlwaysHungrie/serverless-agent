#!/usr/bin/env node
// Plain-text CLI dashboard for the salt-agent deployment.
// Reads deployment-wide stats from GET /api/admin/stats and prints them.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Pull `KEY=VALUE` lines out of agent/.dev.vars, for local runs with no env set. */
function readDevVars() {
  try {
    const text = readFileSync(path.join(here, "..", "agent", ".dev.vars"), "utf8");
    const out = {};
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  } catch {
    return {};
  }
}

const devVars = readDevVars();
const BASE_URL = process.env.AGENT_BASE_URL || "http://127.0.0.1:8787";
const API_SECRET = process.env.API_SECRET || devVars.API_SECRET;

if (!API_SECRET) {
  console.error(
    "No API_SECRET found. Set the API_SECRET env var, or run this from a checkout with agent/.dev.vars present."
  );
  process.exit(1);
}

/** GET/POST/DELETE against the deployment, with the owner's secret attached. */
async function call(path, init = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "x-api-secret": API_SECRET, ...(init.headers ?? {}) },
  }).catch((err) => {
    console.error(`Could not reach ${BASE_URL}: ${err.message}`);
    process.exit(1);
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`${res.status} ${res.statusText}: ${body}`);
    process.exit(1);
  }
  return res.json();
}

const [, , command, arg] = process.argv;

// `admin-cli requests` lists open asks to raise an account's agent limit.
// `admin-cli approve <id>` grants one, folding the increase into the limit.
// `admin-cli reject <id>` drops one without changing anything.
if (command === "requests") {
  const { requests } = await call("/api/admin/business-requests");
  if (!requests.length) {
    console.log("No open business-account requests.");
    process.exit(0);
  }
  const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  console.log(`open business-account requests — ${BASE_URL}`);
  console.log("");
  const cols = [
    ["id", (r) => r.id, 10],
    ["email", (r) => r.email, 30],
    ["current", (r) => String(r.current_limit), 8],
    ["+ requested", (r) => `+${r.requested_increase}`, 12],
    ["filed", (r) => fmtDate(r.created_at), 17],
  ];
  const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  console.log(cols.map(([label, , width]) => pad(label, width)).join(" "));
  console.log(cols.map(([, , width]) => "-".repeat(width)).join(" "));
  for (const row of requests) {
    console.log(cols.map(([, get, width]) => pad(get(row), width)).join(" "));
  }
  console.log("");
  console.log("approve with: admin-cli approve <id>   reject with: admin-cli reject <id>");
  process.exit(0);
}

if (command === "approve" || command === "reject") {
  if (!arg) {
    console.error(`usage: admin-cli ${command} <id>`);
    process.exit(1);
  }
  const result =
    command === "approve"
      ? await call(`/api/admin/business-requests/${arg}/approve`, { method: "POST" })
      : await call(`/api/admin/business-requests/${arg}`, { method: "DELETE" });
  console.log(
    command === "approve"
      ? `approved: ${result.email} now has a limit of ${result.agent_limit}`
      : `rejected request ${arg}`
  );
  process.exit(0);
}

if (command && command !== "stats") {
  console.error(`unknown command "${command}". Try: stats, requests, approve <id>, reject <id>`);
  process.exit(1);
}

const stats = await call("/api/admin/stats");

const fmtDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "-");

console.log(`salt-agent dashboard — ${BASE_URL}`);
console.log("");
console.log(`agents             ${stats.agents}`);
console.log(`users              ${stats.users}`);
console.log(`sessions           ${stats.sessions}`);
console.log(`business accounts  ${stats.business_accounts}`);
console.log("");

const rows = [...stats.per_agent].sort((a, b) => b.sessions - a.sessions);

const cols = [
  ["name", (r) => r.name, 24],
  ["id", (r) => r.id, 10],
  ["admin", (r) => r.admin_email, 28],
  ["members", (r) => String(r.members), 8],
  ["sessions", (r) => String(r.sessions), 8],
  ["limit", (r) => String(r.agent_limit), 6],
  ["created", (r) => fmtDate(r.created_at), 17],
  ["last active", (r) => fmtDate(r.updated_at), 17],
];

const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

console.log(cols.map(([label, , width]) => pad(label, width)).join(" "));
console.log(cols.map(([, , width]) => "-".repeat(width)).join(" "));
for (const row of rows) {
  console.log(cols.map(([, get, width]) => pad(get(row), width)).join(" "));
}
