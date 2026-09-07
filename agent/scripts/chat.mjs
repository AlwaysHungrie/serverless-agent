#!/usr/bin/env node
/**
 * Talk to a session and print what it cost.
 *   node scripts/chat.mjs <session-id> "your message"
 *   node scripts/chat.mjs <session-id> --metrics
 */
const BASE = process.env.AGENT_URL ?? "http://localhost:8787";
const [session = "demo", ...rest] = process.argv.slice(2);
const arg = rest.join(" ").trim();
const root = `${BASE}/agents/session-agent/${session}`;

const usd = (n) => (n < 0.01 ? `$${n.toExponential(3)}` : `$${n.toFixed(6)}`);

async function call(path, init) {
  const res = await fetch(root + path, init);
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json, null, 2));
  return json;
}

function printMetrics(m) {
  const u = m.usage;
  const c = m.cost;
  console.log(`\nsession: ${m.session}   messages: ${m.messages}   model: ${c.model}`);
  console.log("\nresources consumed");
  console.table({
    "DO requests": u.do_requests,
    "DO wall clock (ms)": u.do_wall_clock_ms,
    "DO handler active (ms)": u.do_handler_active_ms,
    "DO GB-seconds": c.gbSeconds.toFixed(9),
    "SQLite rows read": u.do_rows_read,
    "SQLite rows written": u.do_rows_written,
    "SQLite bytes stored": u.sqlite_bytes,
    "prompt tokens": u.prompt_tokens,
    "completion tokens": u.completion_tokens,
  });
  console.log("cost if this ran on Cloudflare (marginal rates)");
  console.table(Object.fromEntries(Object.entries(c.marginalUsd).map(([k, v]) => [k, usd(v)])));
  console.log(`Cloudflare subtotal: ${usd(c.cloudflareUsd)}`);
  console.log(`LLM (OpenRouter):    ${usd(c.marginalUsd.llm)}`);
  console.log(`TOTAL:               ${usd(c.totalUsd)}`);
  console.log(
    `\n${c.note}\nSessions like this one that fit in the included allowances: ` +
      `${m.capacity.sessions === null ? "unbounded (no usage yet)" : m.capacity.sessions.toLocaleString("en-US") + "/month (limited by " + m.capacity.bindingLimit + ")"}.`
  );
}

if (arg === "--metrics") {
  printMetrics(await call("/metrics"));
} else if (arg === "--reset") {
  console.log(await call("/reset", { method: "POST" }));
} else if (arg === "--history") {
  console.log((await call("/history")).messages);
} else {
  if (!arg) {
    console.error('usage: node scripts/chat.mjs <session-id> "message" | --metrics | --history | --reset');
    process.exit(1);
  }
  const res = await call("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: arg }),
  });
  console.log(`\n${res.reply}\n`);
  const r = res._meta.request;
  console.log(
    `this turn: ${r.active_ms}ms active, ${r.llm_ms}ms in the LLM, ` +
      `${r.rows_read} rows read / ${r.rows_written} written, ` +
      `${r.prompt_tokens}+${r.completion_tokens} tokens, ${usd(r.llm_cost_usd)}`
  );
  printMetrics(await call("/metrics"));
}
