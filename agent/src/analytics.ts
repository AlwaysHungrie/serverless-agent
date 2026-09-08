import { PRICING } from "./pricing";

/**
 * Real Durable Object usage, read back from Cloudflare's GraphQL Analytics API.
 *
 * This replaces the counters the agent used to keep about itself. Cloudflare is the
 * billing authority, so its numbers are the ones worth showing — with two honest
 * caveats: the datasets are sampled (hence `sampleInterval`), and they lag by a few
 * minutes, so a message sent seconds ago will not appear yet.
 */

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

export type ActualUsage = {
  requests: number;
  errors: number;
  activeTimeUs: number;
  cpuTimeUs: number;
  subrequests: number;
  /**
   * SQLite-backed objects report `rowsRead`/`rowsWritten`. The similarly named
   * `storageReadUnits`/`storageWriteUnits` belong to the key-value backend and stay
   * at zero here, which is what made these look free.
   */
  rowsRead: number;
  rowsWritten: number;
  /**
   * Namespace-wide, and null until Cloudflare computes it. Stored bytes are not
   * broken down per object, and the dataset is populated on a slow cadence rather
   * than per request, so a namespace deployed today reports nothing yet.
   */
  storedBytesNamespace: number | null;
  sampled: boolean;
};

const QUERY = `
  query ActualUsage($account: String!, $since: Time!, $objectId: String) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        invocations: durableObjectsInvocationsAdaptiveGroups(
          limit: 10000
          filter: { datetime_geq: $since, objectId: $objectId }
        ) {
          sum { requests errors }
          avg { sampleInterval }
        }
        periodic: durableObjectsPeriodicGroups(
          limit: 10000
          filter: { datetime_geq: $since, objectId: $objectId }
        ) {
          sum { activeTime cpuTime subrequests rowsRead rowsWritten }
          avg { sampleInterval }
        }
        storage: durableObjectsStorageGroups(limit: 1, filter: { datetime_geq: $since }) {
          max { storedBytes }
        }
      }
    }
  }
`;

type Group<T> = { sum?: T; max?: T; avg?: { sampleInterval: number } };

function total<T extends Record<string, number>>(groups: Group<T>[] | undefined, key: keyof T): number {
  if (!groups) return 0;
  // Adaptive datasets are sampled: each group represents `sampleInterval` real events.
  return groups.reduce((acc, g) => {
    const value = Number(g.sum?.[key] ?? g.max?.[key] ?? 0);
    const interval = g.avg?.sampleInterval ?? 1;
    return acc + value * (interval > 0 ? interval : 1);
  }, 0);
}

function sampled(groups: Group<Record<string, number>>[] | undefined): boolean {
  return (groups ?? []).some((g) => (g.avg?.sampleInterval ?? 1) > 1);
}

export async function fetchActualUsage(opts: {
  token: string;
  accountId: string;
  /** Omit to get usage across the whole namespace. */
  objectId?: string;
  since: Date;
}): Promise<ActualUsage> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        account: opts.accountId,
        since: opts.since.toISOString(),
        objectId: opts.objectId ?? null,
      },
    }),
  });

  const json = (await res.json()) as {
    data?: { viewer?: { accounts?: [Record<string, Group<Record<string, number>>[]>] } };
    errors?: { message: string }[];
  };

  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  const account = json.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("Cloudflare returned no account data for this token.");

  const invocations = account.invocations;
  const periodic = account.periodic;

  return {
    requests: total(invocations, "requests"),
    errors: total(invocations, "errors"),
    activeTimeUs: total(periodic, "activeTime"),
    cpuTimeUs: total(periodic, "cpuTime"),
    subrequests: total(periodic, "subrequests"),
    rowsRead: total(periodic, "rowsRead"),
    rowsWritten: total(periodic, "rowsWritten"),
    storedBytesNamespace: account.storage?.length ? total(account.storage, "storedBytes") : null,
    sampled: sampled(invocations) || sampled(periodic),
  };
}

/** Price Cloudflare's reported units at Cloudflare's published rates. */
export function costOfActualUsage(u: ActualUsage) {
  const gbSeconds = (u.activeTimeUs / 1_000_000) * PRICING.doMemoryGb;

  const lines = {
    doRequests: (u.requests / 1e6) * PRICING.doRequestsPerMillion,
    doDuration: (gbSeconds / 1e6) * PRICING.doGbSecondsPerMillion,
    doRowsRead: (u.rowsRead / 1e6) * PRICING.doRowsReadPerMillion,
    doRowsWritten: (u.rowsWritten / 1e6) * PRICING.doRowsWrittenPerMillion,
    workerRequests: (u.requests / 1e6) * PRICING.workerRequestsPerMillion,
  };

  return {
    gbSeconds,
    lines,
    cloudflareUsd: Object.values(lines).reduce((a, b) => a + b, 0),
    /** Namespace-wide, not per session, and null until Cloudflare reports bytes. */
    namespaceStorageUsdPerMonth:
      u.storedBytesNamespace === null
        ? null
        : (u.storedBytesNamespace / 1e9) * PRICING.doStorageGbMonth,
  };
}
