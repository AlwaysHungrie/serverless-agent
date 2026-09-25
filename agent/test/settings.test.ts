import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import {
  FACTORY_SETTINGS,
  SettingsError,
  effectiveSettings,
  validateSettingsPatch,
} from "../src/settings";
import { normalizeEmails, sessionLimitMessage } from "../src/registry";

/**
 * The deployment's own knobs.
 *
 * Two halves. The merge and the validator are pure and tested directly, because they
 * are where a wrong answer is silent — a patch that stores a bad number keeps working
 * until something enforces it. The routes are tested over HTTP, because what matters
 * about them is the gate and the fact that a written ceiling is the one actually
 * enforced a moment later.
 *
 * Every test that writes resets afterwards. The settings live in the one directory
 * object, the pool does not roll storage back, and an override left behind would
 * change what every later test in the run is held to.
 */

const SECRET = env.API_SECRET as string;
const BASE = "https://worker.test";

function asOwner(init: RequestInit = {}) {
  return {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-secret": SECRET,
      ...(init.headers as Record<string, string> | undefined),
    },
  };
}

const patch = (body: unknown) =>
  SELF.fetch(`${BASE}/api/admin/settings`, asOwner({ method: "PATCH", body: JSON.stringify(body) }));

const reset = () => SELF.fetch(`${BASE}/api/admin/settings`, asOwner({ method: "DELETE" }));

describe("the effective document", () => {
  it("is the factory values when nothing is overridden", () => {
    expect(effectiveSettings({})).toEqual(FACTORY_SETTINGS);
    expect(effectiveSettings(null)).toEqual(FACTORY_SETTINGS);
  });

  it("takes an override and leaves every other field alone", () => {
    const merged = effectiveSettings({ max_sessions: 4 });
    expect(merged.max_sessions).toBe(4);
    expect(merged.max_agent_bytes).toBe(FACTORY_SETTINGS.max_agent_bytes);
  });

  it("merges the upload ceilings per kind rather than replacing them", () => {
    // The whole reason the stored shape is a patch: raising one kind must not reset
    // the other three to zero, which a wholesale replace would do.
    const merged = effectiveSettings({ max_upload_bytes: { pdf: 99 } as never });
    expect(merged.max_upload_bytes.pdf).toBe(99);
    expect(merged.max_upload_bytes.image).toBe(FACTORY_SETTINGS.max_upload_bytes.image);
  });

  it("keeps a zero an override rather than reading it as absent", () => {
    // `max_tokens: 0` means "no cap", so absence cannot be a sentinel value.
    expect(effectiveSettings({ config_defaults: { max_tokens: 0 } }).config_defaults).toEqual({
      max_tokens: 0,
    });
  });
});

describe("validating a patch", () => {
  it("refuses a key that is not a setting", () => {
    // Refused rather than ignored: a typo that silently did nothing looks exactly like
    // a limit that does not work.
    expect(() => validateSettingsPatch({ max_session: 4 }, {})).toThrow(SettingsError);
  });

  it("refuses a number outside the field's range", () => {
    expect(() => validateSettingsPatch({ max_sessions: 0 }, {})).toThrow(/whole number/);
    expect(() => validateSettingsPatch({ max_tool_rounds: 1.5 }, {})).toThrow(/whole number/);
  });

  it("merges into the overrides already stored", () => {
    const first = validateSettingsPatch({ max_sessions: 4 }, {});
    const second = validateSettingsPatch({ max_members: 9 }, first);
    expect(second).toEqual({ max_sessions: 4, max_members: 9 });
  });

  it("removes an override when a key is set to null", () => {
    const stored = validateSettingsPatch({ max_sessions: 4 }, {});
    expect(validateSettingsPatch({ max_sessions: null }, stored)).toEqual({});
  });

  it("refuses a config column that is not settable deployment-wide", () => {
    // Secrets and per-agent columns are not defaults anybody should be able to set
    // for every agent at once.
    expect(() => validateSettingsPatch({ config_defaults: { telegram_bot_token: "x" } }, {})).toThrow(
      /not a settable column/
    );
  });

  it("checks a settable config column's own range", () => {
    expect(() => validateSettingsPatch({ config_defaults: { temperature: 5 } }, {})).toThrow(
      /between 0 and 2/
    );
    expect(() =>
      validateSettingsPatch({ config_defaults: { reasoning_effort: "extreme" } }, {})
    ).toThrow(/off, low, medium or high/);
  });

  it("stores a capability switch as the integer the column holds", () => {
    const stored = validateSettingsPatch({ config_defaults: { cap_web_search: true } }, {});
    expect(stored.config_defaults).toEqual({ cap_web_search: 1 });
  });

  it("refuses a page default above its own ceiling", () => {
    // It would clamp on every read, which reads as the default being ignored.
    expect(() => validateSettingsPatch({ message_page: 500 }, {})).toThrow(
      /cannot exceed max_message_page/
    );
  });

  it("takes a model list and fills in the label and vision", () => {
    const stored = validateSettingsPatch({ models: [{ id: "a/b" }] }, {});
    expect(stored.models).toEqual([{ id: "a/b", label: "a/b", vision: true }]);
  });

  it("refuses a field_options key that is not a choice field", () => {
    expect(() => validateSettingsPatch({ field_options: { temperature: ["a/b"] } }, {})).toThrow(
      /not a choice field/
    );
  });

  it("refuses a field_options entry that is not a model id", () => {
    expect(() => validateSettingsPatch({ field_options: { voice_model: ["not a model"] } }, {})).toThrow(
      /not an OpenRouter model id/
    );
  });

  it("refuses an MCP catalogue entry that names no url", () => {
    expect(() => validateSettingsPatch({ mcp_catalog: [{ id: "x", name: "X" }] }, {})).toThrow(
      /needs an id, a name and a url/
    );
  });
});

describe("the access list ceiling", () => {
  it("counts against the number it is given", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@x.com`);
    expect(() => normalizeEmails(eleven, 10)).toThrow(/at most 10 addresses/);
    expect(normalizeEmails(eleven, 11).split("\n")).toHaveLength(11);
  });
});

describe("the admin settings route", () => {
  afterEach(async () => {
    await reset();
  });

  it("refuses a caller with no secret", async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/settings`);
    expect(res.status).toBe(401);
  });

  it("serves the document, the overrides and the field list", async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/settings`, asOwner());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settings: Record<string, unknown>;
      overrides: Record<string, unknown>;
      fields: { key: string; kind: string; doc: string }[];
    };
    expect(body.settings.max_sessions).toBe(FACTORY_SETTINGS.max_sessions);
    expect(body.overrides).toEqual({});
    // The CLI draws itself from this, so every setting has to be described by it.
    expect(body.fields.map((f) => f.key)).toContain("max_upload_bytes");
    expect(body.fields.every((f) => f.doc.length > 0)).toBe(true);
  });

  it("saves a setting and reports what is now in force", async () => {
    const res = await patch({ max_sessions: 3 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settings: { max_sessions: number; max_agent_bytes: number };
      overrides: Record<string, unknown>;
    };
    expect(body.settings.max_sessions).toBe(3);
    expect(body.settings.max_agent_bytes).toBe(FACTORY_SETTINGS.max_agent_bytes);
    expect(body.overrides).toEqual({ max_sessions: 3 });
  });

  it("answers a bad value with the reason rather than a 500", async () => {
    const res = await patch({ max_sessions: -1 });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toMatch(/whole number/);
  });

  it("puts every setting back on the shipped values", async () => {
    await patch({ max_sessions: 3, max_members: 7 });
    const res = await reset();
    const body = (await res.json()) as { settings: { max_sessions: number }; overrides: unknown };
    expect(body.settings.max_sessions).toBe(FACTORY_SETTINGS.max_sessions);
    expect(body.overrides).toEqual({});
  });

  it("refuses an unknown method", async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/settings`, asOwner({ method: "PUT" }));
    expect(res.status).toBe(405);
  });
});

describe("a setting the owner changed is the one enforced", () => {
  afterEach(async () => {
    await reset();
  });

  it("holds an account to the agent limit the owner set", async () => {
    await patch({ default_agent_limit: 2 });
    const email = `limits-${crypto.randomUUID().slice(0, 8)}@x.com`;
    const create = (name: string) =>
      SELF.fetch(
        `${BASE}/api/agents`,
        asOwner({
          method: "POST",
          headers: { "x-user-email": email },
          body: JSON.stringify({ name, allowed_emails: email }),
        })
      );
    expect((await create("One")).status).toBe(200);
    expect((await create("Two")).status).toBe(200);
    // The third is the one the raised default refuses, where the shipped 1 would have
    // refused the second.
    const third = await create("Three");
    expect(third.status).toBe(403);
    expect((await third.json<{ error: string }>()).error).toMatch(/at most 2 agents/);
  });

  it("refuses a session past the ceiling the owner set, and says that number", async () => {
    await patch({ max_sessions: 1 });
    const email = `sessions-${crypto.randomUUID().slice(0, 8)}@x.com`;
    const created = await SELF.fetch(
      `${BASE}/api/agents`,
      asOwner({
        method: "POST",
        headers: { "x-user-email": email },
        body: JSON.stringify({ name: "Capped", allowed_emails: email }),
      })
    );
    const { id } = await created.json<{ id: string }>();

    const session = () =>
      SELF.fetch(
        `${BASE}/api/agents/${id}/sessions`,
        asOwner({ method: "POST", headers: { "x-user-email": email }, body: JSON.stringify({}) })
      );
    expect((await session()).status).toBe(200);
    const refused = await session();
    expect(refused.status).toBe(409);
    expect((await refused.json<{ error: string }>()).error).toBe(sessionLimitMessage(1));
  });

  it("offers the model list the owner typed in, ahead of MODELS", async () => {
    await patch({ models: [{ id: "owner/model", label: "Owner's", vision: false }] });
    const res = await SELF.fetch(
      `${BASE}/api/agents/catalog`,
      asOwner({ headers: { "x-user-email": "catalog@x.com" } })
    );
    const body = await res.json<{ models: { id: string }[] }>();
    expect(body.models).toEqual([{ id: "owner/model", label: "Owner's", vision: false }]);
  });

  it("hands the composer the ceilings it has to enforce before it sends", async () => {
    // The browser refuses first, so its number has to be the deployment's number — a
    // page holding its own copy is a limit that drifts from the one that matters.
    await patch({ max_files_per_message: 2, max_upload_bytes: { image: 4_000_000 } });
    const email = `composer-${crypto.randomUUID().slice(0, 8)}@x.com`;
    const created = await SELF.fetch(
      `${BASE}/api/agents`,
      asOwner({
        method: "POST",
        headers: { "x-user-email": email },
        body: JSON.stringify({ name: "Composer", allowed_emails: email }),
      })
    );
    const { id } = await created.json<{ id: string }>();
    const res = await SELF.fetch(
      `${BASE}/api/agents/${id}/config`,
      asOwner({ headers: { "x-user-email": email } })
    );
    const body = await res.json<{
      limits: { max_files_per_message: number; max_upload_bytes: { image: number } };
    }>();
    expect(body.limits.max_files_per_message).toBe(2);
    expect(body.limits.max_upload_bytes.image).toBe(4_000_000);
  });

  it("offers the voice models the owner listed, in place of the shipped menu", async () => {
    await patch({ field_options: { voice_model: ["openai/gpt-audio"] } });
    const res = await SELF.fetch(
      `${BASE}/api/agents/catalog`,
      asOwner({ headers: { "x-user-email": "catalog@x.com" } })
    );
    const body = await res.json<{
      capabilities: { id: string; fields: { key: string; options?: { value: string }[] }[] }[];
    }>();
    const field = body.capabilities
      .flatMap((c) => c.fields)
      .find((f) => f.key === "voice_model");
    expect(field?.options?.map((o) => o.value)).toEqual(["openai/gpt-audio"]);
  });

  it("quotes the owner's own upload ceilings in the capability note", async () => {
    // The note is generated, so a deployment that raised a ceiling and still read the
    // shipped figure would be telling its users something nobody could correct.
    await patch({ max_upload_bytes: { pdf: 32_000_000 } });
    const res = await SELF.fetch(
      `${BASE}/api/agents/catalog`,
      asOwner({ headers: { "x-user-email": "catalog@x.com" } })
    );
    const body = await res.json<{ capabilities: { id: string; note?: string }[] }>();
    const note = body.capabilities.find((c) => c.id === "file_ingest")?.note ?? "";
    expect(note).toContain("32 MB");
  });
});
