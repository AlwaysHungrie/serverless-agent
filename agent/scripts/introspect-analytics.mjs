#!/usr/bin/env node
/**
 * Ask Cloudflare's GraphQL Analytics API which fields the Durable Objects datasets
 * actually expose, so the cost query is built from the real schema rather than guesses.
 *
 *   CLOUDFLARE_API_TOKEN=... node scripts/introspect-analytics.mjs
 */
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!TOKEN) {
  console.error("Set CLOUDFLARE_API_TOKEN (needs the Account Analytics: Read permission).");
  process.exit(1);
}

const DATASETS = [
  "durableObjectsInvocationsAdaptiveGroups",
  "durableObjectsPeriodicGroups",
  "durableObjectsStorageGroups",
  "durableObjectsSubrequestsAdaptiveGroups",
];

const query = `
  query Introspect($name: String!) {
    __type(name: $name) {
      name
      fields { name description type { name kind ofType { name kind } } }
    }
  }
`;

async function typeFields(name) {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { name } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data?.__type?.fields ?? [];
}

for (const dataset of DATASETS) {
  const fields = await typeFields(dataset);
  if (fields.length === 0) {
    console.log(`\n### ${dataset}\n  (not visible to this token)`);
    continue;
  }
  console.log(`\n### ${dataset}`);

  // Dimensions are scalar fields; sum/avg/max/quantiles are nested objects.
  const dimensions = fields.filter((f) => !["sum", "avg", "max", "min", "quantiles"].includes(f.name));
  console.log(`  dimensions: ${dimensions.map((f) => f.name).join(", ")}`);

  for (const agg of ["sum", "avg", "max"]) {
    const field = fields.find((f) => f.name === agg);
    const typeName = field?.type?.name ?? field?.type?.ofType?.name;
    if (!typeName) continue;
    const inner = await typeFields(typeName);
    console.log(`  ${agg}: ${inner.map((f) => f.name).join(", ")}`);
  }
}
