#!/usr/bin/env node
// Interactive CLI dashboard for the salt-agent deployment.
//
// Three screens: the deployment's three counts with the queue of accounts asking for a
// higher agent limit, the detail screen where a request is approved or rejected, and
// the settings screen — every ceiling this deployment enforces and every value an agent
// starts out holding, editable in place.
//
// The field list, the ranges it refuses and the prose beside each row all come from
// `/api/admin/settings`, so a field added to the Worker's `settings.ts` shows up here
// with no edit at all. What this package does hold is `defaults.json`: the values a
// deployment starts from. The Worker ships none of its own and refuses to serve until
// every field is set, so these are the only defaults there are.
//
// Two non-interactive commands, for scripts and the deploy preflight:
//
//   node index.mjs init    write the shipped default for every field not yet set
//   node index.mjs check   exit 1, naming them, if any field is not set; exit 2 if the
//                          live Worker predates settings (the one-time bootstrap)
//
// Both take `--dev` / `--staging` like the dashboard.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The values a fresh deployment starts from. The Worker has no others. */
const DEFAULTS = JSON.parse(readFileSync(path.join(here, "defaults.json"), "utf8"));

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
/** `init`, `check`, or undefined for the dashboard. */
const COMMAND = argv.find((a) => !a.startsWith("-"));
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
    const err = new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
    err.status = res.status;
    throw err;
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

  /** "requests" or "settings". The detail screen is a mode of the first. */
  screen: "requests",
  /** The stored document, the fields it is still missing, and the field list. */
  settings: null,
  missing: [],
  fields: [],
  settingsSelected: 0,
  settingsTop: 0,
  /** Non-null while a value is being typed: `{ key, buffer }`. */
  editing: null,
};

/** Fetch the settings document and the field descriptors that describe it. */
async function loadSettings() {
  state.loading = true;
  render();
  try {
    const doc = await call("/api/admin/settings");
    state.settings = doc.settings;
    state.missing = missingOf(doc);
    state.fields = doc.fields ?? [];
  } catch (err) {
    state.status = `could not load settings — ${err.message}`;
  }
  state.loading = false;
  render();
}

/**
 * What the stored document is missing, from the Worker's answer.
 *
 * A Worker from before every setting was required answers with `overrides` — what it
 * was told — and fills the rest from its own constants. Against one of those, the
 * missing fields are worked out here, so `init` can write them before the upgrade
 * lands and the new Worker comes up complete.
 */
function missingOf(doc) {
  if (Array.isArray(doc.missing)) return doc.missing;
  const stored = doc.overrides ?? {};
  const out = [];
  for (const { key } of doc.fields ?? []) {
    if (stored[key] === undefined) {
      out.push(key);
    } else if (key === "max_upload_bytes" || key === "config_defaults") {
      for (const sub of Object.keys(DEFAULTS[key] ?? {})) {
        if (stored[key][sub] === undefined) out.push(`${key}.${sub}`);
      }
    }
  }
  return out;
}

/** Merge a patch into the stored document. Returns the Worker's answer. */
async function patchSettings(patch) {
  return await call("/api/admin/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/**
 * The shipped default for every field the Worker says is missing, as one patch.
 *
 * Driven by the Worker's own `missing` list rather than by diffing against
 * `defaults.json`, so a field this Worker does not know yet is never sent — it would
 * be refused as unknown. Nested gaps (`max_upload_bytes.audio`) fill only that key.
 */
function defaultsFor(missing) {
  const patch = {};
  for (const entry of missing) {
    const [key, sub] = entry.split(".");
    if (!(key in DEFAULTS)) continue;
    if (sub === undefined) patch[key] = DEFAULTS[key];
    else if (DEFAULTS[key]?.[sub] !== undefined) {
      patch[key] = { ...(patch[key] ?? {}), [sub]: DEFAULTS[key][sub] };
    }
  }
  return patch;
}

/**
 * Every field back on the shipped value. `field_options` merges per column on the
 * Worker, so a column the defaults do not list is sent as null to drop it.
 */
function allDefaults(fields, current) {
  const patch = {};
  for (const { key } of fields) if (key in DEFAULTS) patch[key] = DEFAULTS[key];
  if (patch.field_options) {
    const dropped = Object.keys(current?.field_options ?? {}).filter(
      (column) => !(column in DEFAULTS.field_options)
    );
    patch.field_options = {
      ...DEFAULTS.field_options,
      ...Object.fromEntries(dropped.map((column) => [column, null])),
    };
  }
  return patch;
}

/** Send a patch from the settings screen and show what came back. */
async function saveSettings(patch, done) {
  state.status = "saving…";
  render();
  try {
    const doc = await patchSettings(patch);
    state.settings = doc.settings;
    state.missing = missingOf(doc);
    state.status = done;
  } catch (err) {
    state.status = err.message.replace(/^\d+ [^:]*: /, "");
  }
  render();
}

/** How a value is shown on a row, and what `enter` starts editing. */
function showValue(value) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

/**
 * Read a typed value back for its field.
 *
 * An empty line on a string field is a real empty string — a blank `system_prompt`
 * is the owner choosing to say nothing — so it is not treated as a cancel.
 * Anything the Worker will not take comes back as its own error message, which is the
 * only validation this CLI needs to know about.
 */
function parseValue(field, text) {
  const raw = text.trim();
  if (field.kind === "int" || field.kind === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${field.key} wants a number`);
    return n;
  }
  if (field.kind === "json") {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`${field.key} wants JSON — e.g. {"pdf": 16000000}`);
    }
  }
  return text;
}

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

  if (state.screen === "settings") {
    renderSettings(out);
    process.stdout.write(`\x1b[2J\x1b[H${out.join("\n")}\n`);
    return;
  }

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
    out.push(`${DIM}↑/↓ move   enter open   s settings   q quit${OFF}`);
    if (state.status) out.push(`${DIM}${state.status}${OFF}`);
  }

  process.stdout.write(`\x1b[2J\x1b[H${out.join("\n")}\n`);
}

/**
 * Every ceiling and default, one per row.
 *
 * A row marked `!` is not set, or not wholly — the deployment refuses to serve while
 * any row is. `i` fills every such row with the shipped default.
 */
function renderSettings(out) {
  out.push(
    state.missing.length
      ? `${BOLD}deployment settings${OFF}   ${BOLD}! ${state.missing.length} unset — the deployment is refusing requests${OFF}`
      : `${BOLD}deployment settings${OFF}   ${DIM}all set${OFF}`
  );
  out.push("");
  if (!state.fields.length) {
    out.push(state.loading ? `${DIM}loading…${OFF}` : `${DIM}none available.${OFF}`);
    out.push("");
    out.push(`${DIM}esc back   q quit${OFF}`);
    if (state.status) out.push(`${DIM}${state.status}${OFF}`);
    return;
  }

  const size = Math.max(3, (process.stdout.rows ?? 24) - 12);
  if (state.settingsSelected < state.settingsTop) state.settingsTop = state.settingsSelected;
  if (state.settingsSelected > state.settingsTop + size - 1) {
    state.settingsTop = state.settingsSelected - size + 1;
  }
  state.settingsTop = Math.max(
    0,
    Math.min(state.settingsTop, Math.max(0, state.fields.length - size))
  );
  const rows = state.fields.slice(state.settingsTop, state.settingsTop + size);

  out.push(`${DIM}  ${pad("setting", 22)} ${pad("value", 44)}${OFF}`);
  rows.forEach((field, i) => {
    const idx = state.settingsTop + i;
    const unset = state.missing.some((m) => m === field.key || m.startsWith(`${field.key}.`));
    const value = showValue(state.settings?.[field.key]);
    const line = `${unset ? "!" : " "} ${pad(field.key, 22)} ${pad(value, 44)}`;
    out.push(idx === state.settingsSelected ? `${INV}${line}${OFF}` : line);
  });

  const current = state.fields[state.settingsSelected];
  out.push("");
  if (current) {
    const range =
      current.min !== undefined && current.max !== undefined
        ? `  ${DIM}(${current.min}–${current.max})${OFF}`
        : "";
    out.push(`  ${DIM}${current.doc}${range}${OFF}`);
    const gaps = state.missing.filter((m) => m.startsWith(`${current.key}.`));
    if (gaps.length) out.push(`  ${BOLD}unset: ${gaps.join(", ")}${OFF}`);
    if (current.key in DEFAULTS) {
      out.push(`  ${DIM}shipped: ${pad(showValue(DEFAULTS[current.key]), 70)}${OFF}`);
    }
  }
  out.push("");
  if (state.editing) {
    // The cursor is drawn rather than moved: the screen is repainted whole on every
    // keypress, so a real cursor position would be lost on the next paint.
    out.push(`  ${BOLD}${state.editing.key}${OFF} ${state.editing.buffer}${INV} ${OFF}`);
    out.push("");
    out.push(`${DIM}enter save   esc cancel${OFF}`);
  } else {
    out.push(
      `${DIM}↑/↓ move   enter edit   r shipped value   i fill unset   R all shipped   esc back   q quit${OFF}`
    );
  }
  if (state.status) out.push(`${DIM}${state.status}${OFF}`);
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

/**
 * The settings screen's keys, including the line editor.
 *
 * The editor is deliberately minimal — printable characters, backspace, enter, esc —
 * because every value here is short and the one that is not (a JSON list) is pasted
 * rather than typed, and a paste arrives as a run of printable characters that this
 * handles already.
 */
async function onSettingsKey(key) {
  if (state.editing) {
    if (key === "\x1b") {
      state.editing = null;
      state.status = "";
      return render();
    }
    if (key === "\r" || key === "\n") {
      const field = state.fields.find((f) => f.key === state.editing.key);
      const typed = state.editing.buffer;
      state.editing = null;
      try {
        await saveSettings({ [field.key]: parseValue(field, typed) }, `${field.key} saved`);
      } catch (err) {
        state.status = err.message;
        render();
      }
      return;
    }
    if (key === "\x7f" || key === "\b") {
      state.editing.buffer = state.editing.buffer.slice(0, -1);
      return render();
    }
    // Escape sequences (arrows, function keys) are not text; everything else is.
    if (key.length === 1 && key >= " ") state.editing.buffer += key;
    return render();
  }

  if (key === "\x1b") {
    state.screen = "requests";
    state.status = "";
    return render();
  }
  if (key === "\x1b[A" || key === "k") {
    state.settingsSelected = Math.max(0, state.settingsSelected - 1);
    return render();
  }
  if (key === "\x1b[B" || key === "j") {
    state.settingsSelected = Math.min(state.fields.length - 1, state.settingsSelected + 1);
    return render();
  }
  const field = state.fields[state.settingsSelected];
  if (!field) return render();

  if (key === "\r" || key === "\n") {
    // Opens on the value in force, so an edit is a correction rather than a re-entry.
    state.editing = { key: field.key, buffer: showValue(state.settings?.[field.key]) };
    state.status = "";
    return render();
  }
  if (key === "r") {
    if (!(field.key in DEFAULTS)) {
      state.status = `no shipped value for ${field.key} in defaults.json`;
      return render();
    }
    return await saveSettings({ [field.key]: DEFAULTS[field.key] }, `${field.key} set to the shipped value`);
  }
  if (key === "i") {
    const patch = defaultsFor(state.missing);
    if (!Object.keys(patch).length) {
      state.status = state.missing.length
        ? `no shipped value for: ${state.missing.join(", ")}`
        : "nothing unset";
      return render();
    }
    return await saveSettings(patch, "unset fields filled with the shipped values");
  }
  if (key === "R") {
    return await saveSettings(
      allDefaults(state.fields, state.settings),
      "every setting set to the shipped values"
    );
  }
  return render();
}

function quit() {
  process.stdout.write("\x1b[2J\x1b[H\x1b[?25h");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
}

async function onKey(key) {
  // `q` types a letter while a value is being edited; everywhere else it quits.
  if (!state.editing && (key === "q" || key === "\u0003")) quit();
  if (key === "\u0003") quit();

  if (state.screen === "settings") return await onSettingsKey(key);

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
  else if (key === "s") {
    state.screen = "settings";
    state.status = "";
    render();
    if (!state.fields.length) await loadSettings();
    return;
  } else if (key === "\r" || key === "\n") {
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

if (COMMAND === "init" || COMMAND === "check") {
  const where = `${BASE_URL}${TARGET ? ` [${TARGET.toLowerCase()}]` : ""}`;
  try {
    let doc = await call("/api/admin/settings");
    if (COMMAND === "init") {
      const patch = defaultsFor(missingOf(doc));
      if (Object.keys(patch).length) {
        doc = await patchSettings(patch);
        console.log(`  filled with shipped defaults: ${Object.keys(patch).join(", ")}`);
      }
    }
    const missing = missingOf(doc);
    if (missing.length) {
      console.error(
        `\n  ${where}: settings incomplete — the deployment refuses requests until these are set:\n\n` +
          missing.map((m) => `    ${m}`).join("\n") +
          `\n\n  Run \`npm run init${TARGET ? ` -- --${TARGET.toLowerCase()}` : ""}\` in admin-cli to write the shipped defaults,\n  or set them from the dashboard (\`s\`).\n`
      );
      process.exit(1);
    }
    // Fields this CLI ships a default for that the live Worker has not heard of: a
    // release adding a setting. They cannot be set before that release is live — the
    // current Worker refuses unknown keys — so `npm run deploy` runs `init` after it.
    const known = new Set((doc.fields ?? []).map((f) => f.key));
    const upcoming = Object.keys(DEFAULTS).filter((k) => !known.has(k));
    console.log(`  settings complete (${where})`);
    if (upcoming.length) {
      console.log(
        `  not on the live Worker yet: ${upcoming.join(", ")} — the deploy's \`init\` step sets them.`
      );
    }
    process.exit(0);
  } catch (err) {
    // A Worker from before the settings route: the route is unknown to it, so the
    // request falls through to its identity gate (401) or nowhere (404). Told apart
    // from a wrong secret by `/stats`, which the same secret opens on both versions.
    // `check` says so with its own exit code — the deploy that installs the route is
    // the only way to get one, so the preflight lets it through and `init` follows it.
    if (COMMAND === "check" && (err.status === 401 || err.status === 404)) {
      const predates = await call("/api/admin/stats").then(
        () => true,
        () => false
      );
      if (predates) {
        console.log(
          `  ${where} predates deployment settings — nothing to check yet.\n` +
            "  The deploy installs the route; `init` right after it writes the shipped defaults."
        );
        process.exit(2);
      }
    }
    console.error(`  could not read settings from ${where}: ${err.message}`);
    process.exit(1);
  }
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

// A deployment with settings unset refuses every ordinary request, so there is nothing
// more urgent to show than the rows that need filling.
await loadSettings();
if (state.missing.length) {
  state.screen = "settings";
  state.status = "settings incomplete — press i to fill every unset row with the shipped value";
  render();
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  for (const key of keys(chunk)) await onKey(key);
});
process.stdout.on("resize", render);
process.on("SIGINT", quit);
