#!/usr/bin/env node
// Interactive CLI dashboard for the salt-agent deployment.
//
// Two screens and nothing else: the deployment's three counts, and the queue of
// accounts asking for a higher agent limit. Arrow keys move, Enter opens a request,
// and the detail screen is where it is approved or rejected.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Pull `KEY=VALUE` lines out of a dotenv-style file. Missing file is not an error. */
function readEnvFile(file) {
  try {
    const out = {};
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

// The real process environment wins, then this package's own `.env`, then the
// Worker's `.dev.vars` — which is where the local secret already lives, so a
// checkout needs no extra setup to talk to a `wrangler dev` on this machine.
const fileEnv = {
  ...readEnvFile(path.join(here, "..", "agent", ".dev.vars")),
  ...readEnvFile(path.join(here, ".env")),
};
const conf = (key) => process.env[key] ?? fileEnv[key];

// `--dev` and `--staging` each swap every lookup to that deployment's twin: a
// different Worker, and usually a different secret with it. No flag means production.
const argv = process.argv.slice(2);
const TARGET = argv.some((a) => a === "--dev" || a === "-d")
  ? "DEV"
  : argv.some((a) => a === "--staging" || a === "-s")
    ? "STAGING"
    : "";
const pick = (key) =>
  TARGET ? conf(`${key}_${TARGET}`) ?? conf(`${TARGET}_${key}`) : conf(key);

const BASE_URL = (pick("AGENT_URL") ?? "").replace(/\/+$/, "");
const API_SECRET = pick("API_SECRET");

if (!BASE_URL) {
  console.error(
    `No ${TARGET ? `AGENT_URL_${TARGET}` : "AGENT_URL"} set. Put it in admin-cli/.env (see .env.example) or in the environment.`
  );
  process.exit(1);
}
if (!API_SECRET) {
  console.error(
    `No ${TARGET ? `API_SECRET_${TARGET}` : "API_SECRET"} found. Put it in admin-cli/.env, or run from a checkout with agent/.dev.vars present.`
  );
  process.exit(1);
}

/** A call against the deployment, with the owner's secret attached. */
async function call(pathname, init = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: { "x-api-secret": API_SECRET, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  return res.json();
}

const PAGE = 20;

const state = {
  counts: null,
  requests: [],
  cursor: "",
  hasMore: true,
  loading: false,
  selected: 0,
  /** Index into `requests`, or -1 while the list itself is on screen. */
  detail: -1,
  choice: 0, // 0 approve, 1 reject
  top: 0, // first visible row, moved only when the selection would leave the window
  status: "",
};

/** Fetch the next page, appending it. Called on startup and as the cursor nears the end. */
async function loadMore() {
  if (state.loading || !state.hasMore) return;
  state.loading = true;
  render();
  try {
    const page = await call(
      `/api/admin/business-requests?limit=${PAGE}${state.cursor ? `&cursor=${encodeURIComponent(state.cursor)}` : ""}`
    );
    state.requests.push(...page.requests);
    state.cursor = page.cursor;
    state.hasMore = page.has_more;
  } catch (err) {
    state.status = `could not load requests — ${err.message}`;
    state.hasMore = false;
  }
  state.loading = false;
  render();
}

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const INV = "\x1b[7m";
const OFF = "\x1b[0m";

const pad = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/** How many list rows fit under the header, leaving room for the footer. */
function viewport() {
  return Math.max(3, (process.stdout.rows ?? 24) - 10);
}

function render() {
  const out = [];
  out.push(`${BOLD}salt-agent${OFF} ${DIM}${BASE_URL}${TARGET ? `  [${TARGET.toLowerCase()}]` : ""}${OFF}`);
  out.push("");
  const c = state.counts;
  out.push(
    c
      ? `users ${BOLD}${c.users}${OFF}   agents ${BOLD}${c.agents}${OFF}   sessions ${BOLD}${c.sessions}${OFF}`
      : `${DIM}loading counts…${OFF}`
  );
  out.push("");

  if (state.detail >= 0) {
    const r = state.requests[state.detail];
    out.push(`${BOLD}limit increase request${OFF} ${DIM}${r.id}${OFF}`);
    out.push("");
    out.push(`  user                ${r.email}`);
    out.push(`  current agents      ${r.current_agents}`);
    out.push(`  current limit       ${r.current_limit}`);
    out.push(`  requested increase  +${r.requested_increase}  ${DIM}→ ${r.current_limit + r.requested_increase}${OFF}`);
    out.push(`  filed               ${fmtDate(r.created_at)}`);
    out.push("");
    const buttons = ["  Approve  ", "  Reject  "].map((label, i) =>
      i === state.choice ? `${INV}${label}${OFF}` : `${DIM}${label}${OFF}`
    );
    out.push(`  ${buttons.join("  ")}`);
    out.push("");
    out.push(`${DIM}←/→ choose   enter confirm   esc back   q quit${OFF}`);
    if (state.status) out.push(`${DIM}${state.status}${OFF}`);
  } else {
    out.push(`${BOLD}limit increase requests${OFF}`);
    if (!state.requests.length) {
      out.push("");
      out.push(state.loading ? `${DIM}loading…${OFF}` : `${DIM}none open.${OFF}`);
    } else {
      const size = viewport();
      // The window follows the selection only when it would otherwise fall off an
      // edge, so the list scrolls a row at a time instead of jumping a page.
      if (state.selected < state.top) state.top = state.selected;
      if (state.selected > state.top + size - 1) state.top = state.selected - size + 1;
      state.top = Math.max(0, Math.min(state.top, Math.max(0, state.requests.length - size)));
      const top = state.top;
      const rows = state.requests.slice(top, top + size);
      out.push(`${DIM}${pad("email", 34)} ${pad("limit", 7)} ${pad("wants", 7)} ${pad("filed", 17)}${OFF}`);
      rows.forEach((r, i) => {
        const idx = top + i;
        const line = `${pad(r.email, 34)} ${pad(String(r.current_limit), 7)} ${pad(`+${r.requested_increase}`, 7)} ${pad(fmtDate(r.created_at), 17)}`;
        out.push(idx === state.selected ? `${INV}${line}${OFF}` : line);
      });
      if (state.loading) out.push(`${DIM}loading more…${OFF}`);
      else if (state.hasMore) out.push(`${DIM}scroll for more${OFF}`);
    }
    out.push("");
    out.push(`${DIM}↑/↓ move   enter open   q quit${OFF}`);
    if (state.status) out.push(`${DIM}${state.status}${OFF}`);
  }

  process.stdout.write(`\x1b[2J\x1b[H${out.join("\n")}\n`);
}

/** Act on the open request, then drop it from the list — resolved either way. */
async function resolve(approve) {
  const r = state.requests[state.detail];
  state.status = approve ? "approving…" : "rejecting…";
  render();
  try {
    if (approve) {
      const res = await call(`/api/admin/business-requests/${r.id}/approve`, { method: "POST" });
      state.status = `approved — ${res.email} now has a limit of ${res.agent_limit}`;
    } else {
      await call(`/api/admin/business-requests/${r.id}`, { method: "DELETE" });
      state.status = `rejected ${r.email}`;
    }
    state.requests.splice(state.detail, 1);
    state.selected = Math.max(0, Math.min(state.selected, state.requests.length - 1));
    state.detail = -1;
    state.choice = 0;
    if (approve) state.counts = await call("/api/admin/stats");
  } catch (err) {
    state.status = err.message;
  }
  render();
}

/**
 * Split one read into individual keypresses. A terminal usually delivers one at a
 * time, but not always — an arrow key is three bytes, and a held key or a paste can
 * arrive as one chunk — so escape sequences are kept whole and everything else is
 * one character.
 */
function keys(chunk) {
  const out = [];
  for (let i = 0; i < chunk.length; ) {
    if (chunk[i] === "\x1b" && chunk[i + 1] === "[") {
      let j = i + 2;
      while (j < chunk.length && !/[A-Za-z~]/.test(chunk[j])) j++;
      out.push(chunk.slice(i, j + 1));
      i = j + 1;
    } else {
      out.push(chunk[i]);
      i++;
    }
  }
  return out;
}

function quit() {
  process.stdout.write("\x1b[2J\x1b[H\x1b[?25h");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
}

async function onKey(key) {
  if (key === "q" || key === "\u0003") quit();

  if (state.detail >= 0) {
    if (key === "\x1b[D" || key === "h") state.choice = 0;
    else if (key === "\x1b[C" || key === "l") state.choice = 1;
    else if (key === "\x1b") {
      state.detail = -1;
      state.status = "";
    } else if (key === "\r" || key === "\n") return resolve(state.choice === 0);
    return render();
  }

  if (key === "\x1b[A" || key === "k") state.selected = Math.max(0, state.selected - 1);
  else if (key === "\x1b[B" || key === "j")
    state.selected = Math.min(state.requests.length - 1, state.selected + 1);
  else if (key === "\r" || key === "\n") {
    if (state.requests.length) {
      state.detail = state.selected;
      state.choice = 0;
      state.status = "";
    }
  }
  render();
  // Fetch ahead of the cursor rather than at the very last row, so the list keeps
  // moving while the next page is in flight.
  if (state.selected >= state.requests.length - 5) await loadMore();
}

process.stdout.write("\x1b[?25l");
render();

try {
  state.counts = await call("/api/admin/stats");
} catch (err) {
  process.stdout.write("\x1b[?25h");
  console.error(`Could not reach ${BASE_URL}: ${err.message}`);
  process.exit(1);
}
render();
await loadMore();

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  for (const key of keys(chunk)) await onKey(key);
});
process.stdout.on("resize", render);
process.on("SIGINT", quit);
