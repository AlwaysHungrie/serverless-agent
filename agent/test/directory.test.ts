import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AGENT_LIMIT } from "../src/registry";

/**
 * `AgentDirectory` — the one object that knows which agents exist, who administers
 * them, who may open them, and how many each account is allowed.
 *
 * This is the object where a mistake is deployment-wide rather than per-agent, so the
 * tests lean on the two rules that matter most: the membership index and the access
 * list are two projections of one decision and may never disagree, and the agent
 * ceiling is counted against administered agents rather than visible ones.
 */

function directory() {
  return env.AgentDirectory.get(env.AgentDirectory.idFromName(crypto.randomUUID()));
}

let dir: ReturnType<typeof directory>;
beforeEach(() => {
  dir = directory();
});

describe("creating agents", () => {
  it("creates an agent and reads it back", async () => {
    const created = await dir.create("a1", "First", "user@x.com", "user@x.com");
    expect(created.id).toBe("a1");
    expect((await dir.get("a1"))?.name).toBe("First");
  });

  it("returns undefined for an agent that does not exist", async () => {
    expect(await dir.get("nope")).toBeUndefined();
  });

  it("takes the admin from the first address when none is given", async () => {
    // Agents made before admin and access were separate have only a list; the first
    // address on it is the closest thing to a creator that was ever written down.
    const created = await dir.create("a1", "First", "first@x.com\nsecond@x.com", "");
    expect(created.admin_email).toBe("first@x.com");
  });

  it("lowercases the admin", async () => {
    const created = await dir.create("a1", "First", "user@x.com", "  USER@X.com ");
    expect(created.admin_email).toBe("user@x.com");
  });

  it("records an agent created into a fleet", async () => {
    const created = await dir.create("a1", "First", "u@x.com", "u@x.com", {
      id: "f1",
      name: "Fleet One",
    });
    expect(created.fleet_id).toBe("f1");
    expect(created.fleet_name).toBe("Fleet One");
  });

  it("leaves a standalone agent with no fleet", async () => {
    const created = await dir.create("a1", "First", "u@x.com", "u@x.com");
    expect(created.fleet_id).toBe("");
  });
});

describe("membership", () => {
  it("lists an agent for an address on its access list", async () => {
    await dir.create("a1", "First", "member@x.com", "admin@x.com");
    expect((await dir.list("member@x.com")).map((a) => a.id)).toEqual(["a1"]);
  });

  it("lists an agent for its admin even when they are not a member", async () => {
    await dir.create("a1", "First", "member@x.com", "admin@x.com");
    // Administering an agent you cannot open is the ordinary case now the two are
    // separate, and the dashboard still has to show it.
    expect((await dir.list("admin@x.com")).map((a) => a.id)).toEqual(["a1"]);
  });

  it("does not list an agent for an unrelated address", async () => {
    await dir.create("a1", "First", "member@x.com", "admin@x.com");
    expect(await dir.list("stranger@x.com")).toEqual([]);
  });

  it("lists every agent when no address is given", async () => {
    await dir.create("a1", "One", "a@x.com", "a@x.com");
    await dir.create("a2", "Two", "b@x.com", "b@x.com");
    expect((await dir.list()).map((a) => a.id).sort()).toEqual(["a1", "a2"]);
  });

  it("keeps the index and the stored list in step when membership changes", async () => {
    await dir.create("a1", "First", "old@x.com", "admin@x.com");
    await dir.setAllowedEmails("a1", "new@x.com");
    // The two are written in one transaction precisely so they cannot disagree; a
    // removed address still reachable through the index is an access-control bug.
    expect(await dir.list("old@x.com")).toEqual([]);
    expect((await dir.list("new@x.com")).map((a) => a.id)).toEqual(["a1"]);
    expect((await dir.get("a1"))?.allowed_emails).toBe("new@x.com");
  });

  it("removes every member when the list is emptied", async () => {
    await dir.create("a1", "First", "a@x.com\nb@x.com", "admin@x.com");
    await dir.setAllowedEmails("a1", "");
    expect(await dir.list("a@x.com")).toEqual([]);
    expect(await dir.list("b@x.com")).toEqual([]);
    // The admin still sees it, which is what keeps an emptied agent recoverable.
    expect((await dir.list("admin@x.com")).map((a) => a.id)).toEqual(["a1"]);
  });

  it("lists an agent once for an address that is both admin and member", async () => {
    await dir.create("a1", "First", "both@x.com", "both@x.com");
    // The query unions two paths onto the list; without the UNION this row appears
    // twice and the page size silently halves.
    expect(await dir.list("both@x.com")).toHaveLength(1);
  });

  it("does not list anything for an empty address", async () => {
    await dir.create("a1", "First", "a@x.com", "a@x.com");
    expect(await dir.list("")).toEqual([]);
  });
});

describe("paging", () => {
  it("pages without repeating or skipping an agent", async () => {
    for (let i = 0; i < 5; i++) {
      await dir.create(`a${i}`, `Agent ${i}`, "u@x.com", "u@x.com");
    }
    const first = await dir.listPage("u@x.com", 2);
    expect(first.agents).toHaveLength(2);
    expect(first.has_more).toBe(true);

    const second = await dir.listPage("u@x.com", 2, first.cursor);
    const third = await dir.listPage("u@x.com", 2, second.cursor);
    const ids = [...first.agents, ...second.agents, ...third.agents].map((a) => a.id);
    expect(new Set(ids).size).toBe(5);
    expect(third.has_more).toBe(false);
  });

  it("returns an empty page for an address with no agents", async () => {
    expect(await dir.listPage("nobody@x.com")).toEqual({ agents: [], has_more: false, cursor: "" });
  });

  it("returns an empty page for an empty address", async () => {
    await dir.create("a1", "First", "u@x.com", "u@x.com");
    expect((await dir.listPage("")).agents).toEqual([]);
  });
});

describe("fleets", () => {
  it("groups an admin's agents into fleets with counts", async () => {
    await dir.create("a1", "One", "u@x.com", "u@x.com", { id: "f1", name: "Fleet One" });
    await dir.create("a2", "Two", "u@x.com", "u@x.com", { id: "f1", name: "Fleet One" });
    await dir.create("a3", "Three", "u@x.com", "u@x.com", { id: "f2", name: "Fleet Two" });
    const fleets = await dir.listFleets("u@x.com");
    expect(fleets.map((f) => [f.fleet_id, f.agents])).toEqual([
      ["f1", 2],
      ["f2", 1],
    ]);
  });

  it("leaves standalone agents out of the fleet list", async () => {
    await dir.create("a1", "Alone", "u@x.com", "u@x.com");
    expect(await dir.listFleets("u@x.com")).toEqual([]);
  });

  it("shows no fleets to an address that administers none", async () => {
    await dir.create("a1", "One", "u@x.com", "u@x.com", { id: "f1", name: "Fleet One" });
    expect(await dir.listFleets("other@x.com")).toEqual([]);
  });

  it("pages the agents inside a fleet", async () => {
    for (let i = 0; i < 3; i++) {
      await dir.create(`a${i}`, `Agent ${i}`, "u@x.com", "u@x.com", { id: "f1", name: "F" });
    }
    const page = await dir.listFleetPage("f1", 2);
    expect(page.agents).toHaveLength(2);
    expect(page.has_more).toBe(true);
  });

  it("returns nothing for an empty fleet id", async () => {
    expect((await dir.listFleetPage("")).agents).toEqual([]);
  });

  it("stores and clears a fleet's meta document", async () => {
    await dir.setFleetMeta("f1", '{"model":"vendor/x"}');
    expect(await dir.fleetMeta("f1")).toBe('{"model":"vendor/x"}');
    await dir.removeFleetMeta("f1");
    expect(await dir.fleetMeta("f1")).toBe("");
  });

  it("returns an empty document for a fleet that has none", async () => {
    expect(await dir.fleetMeta("never-set")).toBe("");
  });
});

describe("agent limits", () => {
  it("gives an account with no row the default ceiling", async () => {
    expect(await dir.getAgentLimit("nobody@x.com")).toBe(DEFAULT_AGENT_LIMIT);
  });

  it("raises a ceiling and reads it back", async () => {
    await dir.setAgentLimit("biz@x.com", 25);
    expect(await dir.getAgentLimit("biz@x.com")).toBe(25);
  });

  it("matches the account regardless of case or spacing", async () => {
    await dir.setAgentLimit("  BIZ@X.com ", 25);
    expect(await dir.getAgentLimit("biz@x.com")).toBe(25);
  });

  it("replaces a ceiling rather than adding a second row", async () => {
    await dir.setAgentLimit("biz@x.com", 25);
    await dir.setAgentLimit("biz@x.com", 5);
    expect(await dir.getAgentLimit("biz@x.com")).toBe(5);
    expect(await dir.businessAccounts()).toBe(1);
  });

  it("counts agents by admin, not by membership", async () => {
    await dir.create("a1", "One", "member@x.com", "admin@x.com");
    await dir.create("a2", "Two", "member@x.com", "admin@x.com");
    await dir.create("a3", "Three", "member@x.com", "other@x.com");
    // The ceiling bounds what an account *administers*. Counting agents it can merely
    // open would let anyone raise someone else's usage by adding them to a list.
    expect(await dir.countByAdmin("admin@x.com")).toBe(2);
    expect(await dir.countByAdmin("member@x.com")).toBe(0);
  });

  it("reports every raised account", async () => {
    await dir.setAgentLimit("a@x.com", 10);
    await dir.setAgentLimit("b@x.com", 20);
    expect(await dir.agentLimits()).toEqual({ "a@x.com": 10, "b@x.com": 20 });
  });

  it("counts no business accounts before any ceiling is raised", async () => {
    expect(await dir.businessAccounts()).toBe(0);
  });
});

describe("business requests", () => {
  it("files a request and lists it", async () => {
    await dir.fileBusinessRequest("asker@x.com", 5);
    const page = await dir.listBusinessRequests();
    expect(page.requests).toHaveLength(1);
    expect(page.requests[0].requested_increase).toBe(5);
  });

  it("shows the owner what the account has now", async () => {
    await dir.setAgentLimit("asker@x.com", 3);
    await dir.create("a1", "One", "asker@x.com", "asker@x.com");
    await dir.fileBusinessRequest("asker@x.com", 5);
    const [request] = (await dir.listBusinessRequests()).requests;
    expect(request.current_limit).toBe(3);
    expect(request.current_agents).toBe(1);
  });

  it("lowercases the address a request is filed under", async () => {
    await dir.fileBusinessRequest("  Asker@X.COM ", 5);
    expect((await dir.listBusinessRequests()).requests[0].email).toBe("asker@x.com");
  });

  it("approving folds the increase into the ceiling and clears the request", async () => {
    await dir.setAgentLimit("asker@x.com", 2);
    const filed = await dir.fileBusinessRequest("asker@x.com", 5);
    const result = await dir.approveBusinessRequest(filed.id);
    expect(result).toEqual({ email: "asker@x.com", agent_limit: 7 });
    expect(await dir.getAgentLimit("asker@x.com")).toBe(7);
    expect((await dir.listBusinessRequests()).requests).toEqual([]);
  });

  it("approving an account with no ceiling starts from the default", async () => {
    const filed = await dir.fileBusinessRequest("asker@x.com", 4);
    const result = await dir.approveBusinessRequest(filed.id);
    expect(result?.agent_limit).toBe(DEFAULT_AGENT_LIMIT + 4);
  });

  it("approving twice does nothing the second time", async () => {
    const filed = await dir.fileBusinessRequest("asker@x.com", 5);
    await dir.approveBusinessRequest(filed.id);
    // A second click, or a retry, must not raise the ceiling again.
    expect(await dir.approveBusinessRequest(filed.id)).toBeUndefined();
    expect(await dir.getAgentLimit("asker@x.com")).toBe(DEFAULT_AGENT_LIMIT + 5);
  });

  it("declining removes the request without changing the ceiling", async () => {
    const filed = await dir.fileBusinessRequest("asker@x.com", 5);
    await dir.deleteBusinessRequest(filed.id);
    expect((await dir.listBusinessRequests()).requests).toEqual([]);
    expect(await dir.getAgentLimit("asker@x.com")).toBe(DEFAULT_AGENT_LIMIT);
  });

  it("pages the queue oldest first without repeats", async () => {
    for (let i = 0; i < 5; i++) await dir.fileBusinessRequest(`u${i}@x.com`, 1);
    const first = await dir.listBusinessRequests(2);
    expect(first.has_more).toBe(true);
    const second = await dir.listBusinessRequests(2, first.cursor);
    const ids = [...first.requests, ...second.requests].map((r) => r.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("deleting agents", () => {
  it("removes the agent and its membership rows together", async () => {
    await dir.create("a1", "First", "member@x.com", "admin@x.com");
    await dir.remove("a1");
    expect(await dir.get("a1")).toBeUndefined();
    // A membership row outliving its agent would keep it on somebody's home page as
    // a listing that 404s when opened.
    expect(await dir.list("member@x.com")).toEqual([]);
    expect(await dir.list("admin@x.com")).toEqual([]);
  });

  it("frees a slot against the admin's ceiling", async () => {
    await dir.create("a1", "First", "u@x.com", "u@x.com");
    await dir.remove("a1");
    expect(await dir.countByAdmin("u@x.com")).toBe(0);
  });

  it("removing an agent that does not exist is harmless", async () => {
    await expect(dir.remove("never-existed")).resolves.not.toThrow();
  });
});

describe("deployment counts", () => {
  it("counts users, agents and sessions", async () => {
    await dir.create("a1", "One", "a@x.com", "a@x.com");
    await dir.create("a2", "Two", "b@x.com", "b@x.com");
    await dir.setSessionCount("a1", 3);
    await dir.setSessionCount("a2", 4);
    const counts = await dir.counts();
    expect(counts.agents).toBe(2);
    expect(counts.sessions).toBe(7);
    expect(counts.users).toBe(2);
  });

  it("counts an address administering several agents once", async () => {
    await dir.create("a1", "One", "u@x.com", "u@x.com");
    await dir.create("a2", "Two", "u@x.com", "u@x.com");
    expect(await dir.distinctUsers()).toBe(1);
  });

  it("reports agents whose session count has never been measured", async () => {
    await dir.create("a1", "One", "u@x.com", "u@x.com");
    // `-1` is the mark of a row that predates the cached counter; the stats route
    // fills those in once rather than treating them as agents with no sessions.
    expect(await dir.unmeasuredAgents()).toEqual(["a1"]);
    await dir.setSessionCount("a1", 0);
    expect(await dir.unmeasuredAgents()).toEqual([]);
  });
});
