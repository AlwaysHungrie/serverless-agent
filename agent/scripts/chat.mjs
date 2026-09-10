#!/usr/bin/env node
/**
 * Talk to a session from the terminal.
 *   node scripts/chat.mjs <session-id> "your message"
 *   node scripts/chat.mjs <session-id> --summary | --history | --reset
 *
 * Cloudflare's own costs are not reported here. See
 * docs/cloudflare-durable-object-costs.md for how to read them from the analytics API.
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

function printSummary(s) {
  console.log(`\nsession: ${s.session}   messages: ${s.messages}   model: ${s.llm.model}`);
  console.table({
    "prompt tokens": s.llm.prompt_tokens,
    "completion tokens": s.llm.completion_tokens,
    "LLM cost": usd(s.llm.cost_usd),
    "SQLite bytes": s.sqlite_bytes,
  });
}

if (arg === "--summary") {
  printSummary(await call("/summary"));
} else if (arg === "--reset") {
  console.log(await call("/reset", { method: "POST" }));
} else if (arg === "--history") {
  // The route pages from the end; the CLI wants the whole thing, so it asks for the
  // largest page the agent will serve.
  console.log((await call("/messages?limit=200")).messages);
} else {
  if (!arg) {
    console.error('usage: node scripts/chat.mjs <session-id> "message" | --summary | --history | --reset');
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
    `this turn: ${r.llm_ms}ms in the model, ` +
      `${r.prompt_tokens}+${r.completion_tokens} tokens, ${usd(r.llm_cost_usd)}`
  );
  printSummary(await call("/summary"));
}
