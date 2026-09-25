import type { Config, McpCatalogEntry } from "./registry";
import type { Env, ModelOption } from "./agent";

/**
 * The deployment's own knobs: every ceiling this Worker enforces, and every value an
 * agent starts out holding, in one document the owner can change without a deploy.
 *
 * Why a document and not constants. A ceiling is a decision about a deployment, not
 * about the code — the same Worker runs a demo where 20 sessions is generous and a
 * business account where 256 is tight, and today the only way to tell them apart is
 * to edit a number and ship. `MODELS` already made that argument for the model list
 * and won it; this is the same move for the rest.
 *
 * Why only overrides are stored. The row holds a *patch*, never the whole document,
 * so a factory value this deployment never touched keeps tracking the code. Raise
 * `max_upload_bytes.pdf` in a release and every deployment that never overrode it
 * gets the new number; the one that did keeps its own. The alternative — writing the
 * whole document out on first read — freezes every field at whatever the defaults
 * were on the day the owner first opened the dialog, including the fields they never
 * looked at.
 *
 * Why `0` is not "absent". Several of these are legitimately zero (`max_tokens: 0` is
 * "no cap"), so absence has to be key-not-present rather than a sentinel. That is
 * what makes the stored shape `Partial`, and what makes `effectiveSettings` a merge
 * rather than a coalesce.
 *
 * Secrets are deliberately not here. An OpenRouter key, a bot token and a Meta app
 * secret belong to one agent and are billed to it; a deployment-wide default for one
 * would be a deployment-wide key, which is the thing `openrouter_api_key` exists to
 * prevent. `config_defaults` is restricted to `SETTABLE_CONFIG_KEYS` for that reason.
 */

/** Attachment ceilings, per kind. */
export type UploadLimits = {
  text: number;
  pdf: number;
  image: number;
  audio: number;
};

/**
 * The config columns a deployment may pick a starting value for.
 *
 * Tuning and capability switches only. Every column left out is either a secret, or
 * per-agent by nature (`agent_name`, the whitelists, the WhatsApp number), or the
 * model — which has its own field because it is also validated against the catalogue.
 */
export const SETTABLE_CONFIG_KEYS = [
  "temperature",
  "max_tokens",
  "reasoning_effort",
  "context_messages",
  "image_model",
  "transcription_model",
  "voice_model",
  "cap_web_search",
  "cap_url_fetch",
  "cap_file_ingest",
  "cap_vision",
  "cap_image_generation",
  "cap_audio_input",
  "cap_voice_output",
  "cap_scheduled_tasks",
  "cap_memory",
  "cap_telegram",
  "cap_whatsapp",
  "cap_mcp",
] as const;

export type SettableConfigKey = (typeof SETTABLE_CONFIG_KEYS)[number];

/**
 * The config columns whose *list of choices* a deployment may widen.
 *
 * These three are the fixed-choice fields on the capabilities page: the page offers a
 * menu rather than a text box, because most OpenRouter ids would fail outright for the
 * modality the capability needs. Which ids are on that menu is still a question about
 * the deployment, so it is answerable here — `MetaSettings.field_options` answers the
 * same question one agent at a time, and wins where it has an answer.
 *
 * Named here rather than read off `CAPABILITIES` so this module does not import
 * `capabilities.ts`, which imports this one.
 */
export const CHOICE_FIELD_KEYS = ["image_model", "transcription_model", "voice_model"] as const;

export type DeploymentSettings = {
  /* ---- hard limits ---- */

  /** How many sessions one agent may hold at once. */
  max_sessions: number;
  /** How many bytes of uploaded and generated files one agent may hold, across every session. */
  max_agent_bytes: number;
  /** How many addresses one agent's access list may grow to. */
  max_members: number;
  /** How many agents an account with no `account_limits` row may administer. */
  default_agent_limit: number;
  /** Attachment ceilings, per kind. */
  max_upload_bytes: UploadLimits;
  /** Past this, a first-page render is not a thumbnail. */
  max_thumbnail_bytes: number;
  /** How many times one turn may call tools before it must answer. */
  max_tool_rounds: number;
  /** Messages per transcript page when the caller does not ask for a size. */
  message_page: number;
  /** The largest transcript page any caller may ask for. */
  max_message_page: number;
  /** Sessions per page when the caller does not ask for a size. */
  session_page: number;
  /** Agents per page when the caller does not ask for a size. */
  agent_page: number;
  /** The largest agent page any caller may ask for. */
  max_agent_page: number;
  /** How much text one voice note may carry. */
  voice_note_limit: number;
  /**
   * How many attachments one message may carry.
   *
   * Enforced in the composer rather than in the Worker — it is about how much a single
   * turn should be asked to read, not about what the deployment can hold — so it is
   * served to the page alongside the upload ceilings it sits next to.
   */
  max_files_per_message: number;
  /** The largest session page any caller may ask for. */
  max_session_page: number;

  /* ---- soft defaults ---- */

  /**
   * The models the settings page offers. Empty falls through to `MODELS`, then to
   * `MODEL` — so a deployment that has said nothing here behaves exactly as before.
   */
  models: ModelOption[];
  /** The model every new agent is seeded with. Empty falls through to `MODEL`. */
  default_model: string;
  /**
   * What every agent is told before its own `system_prompt`. Empty keeps the built-in
   * line, which is what a deployment that has not thought about it should get.
   */
  system_prompt: string;
  /** Starting values for the tuning and capability columns. Absent keeps the factory value. */
  config_defaults: Partial<Pick<Config, SettableConfigKey>>;
  /**
   * MCP providers offered on the capabilities page, in place of the ones the frontend
   * ships. Empty leaves the built-in presets alone.
   */
  mcp_catalog: McpCatalogEntry[];
  /** Which built-in preset ids are offered. Empty means every preset. */
  mcp_templates: string[];
  /**
   * Extra choices for the fixed-choice model fields, by config column — one of
   * `CHOICE_FIELD_KEYS`. They replace the menu the Worker ships for that field rather
   * than adding to it, which is the rule `MetaSettings.field_options` already follows,
   * so a deployment that wants the shipped ids plus one lists all of them. An absent
   * or empty list leaves the shipped menu alone.
   */
  field_options: Record<string, string[]>;
};

/**
 * The values this Worker ships with — the constants that used to be spread across
 * `registry.ts`, `agent.ts` and `capabilities.ts`, now in one place with a name.
 *
 * Changing a number here changes it for every deployment that has not overridden that
 * field, which is the point of storing a patch rather than a document.
 */
export const FACTORY_SETTINGS: DeploymentSettings = {
  max_sessions: 256,
  max_agent_bytes: 50_000_000,
  max_members: 200,
  default_agent_limit: 1,
  max_upload_bytes: {
    text: 1_000_000,
    pdf: 8_000_000,
    image: 10_000_000,
    audio: 25_000_000,
  },
  max_thumbnail_bytes: 2_000_000,
  max_tool_rounds: 6,
  message_page: 30,
  max_message_page: 200,
  session_page: 30,
  agent_page: 30,
  max_agent_page: 100,
  voice_note_limit: 1500,
  max_files_per_message: 4,
  max_session_page: 200,

  models: [],
  default_model: "",
  system_prompt: "",
  config_defaults: {},
  mcp_catalog: [],
  mcp_templates: [],
  field_options: {},
};

/** A stored override document: only the fields this deployment has decided for itself. */
export type SettingsPatch = Partial<DeploymentSettings>;

/**
 * One field, as the admin CLI needs to draw and check it.
 *
 * Served over `/api/admin/settings` rather than duplicated in the CLI, so a field
 * added here shows up in the dialog without a second edit — and so the range the CLI
 * refuses is the same range the Worker refuses.
 */
export type SettingsField = {
  key: keyof DeploymentSettings;
  kind: "int" | "number" | "string" | "json";
  /** Inclusive, for the numeric kinds. */
  min?: number;
  max?: number;
  /** What the field decides, in one line. */
  doc: string;
};

const INT = (
  key: keyof DeploymentSettings,
  min: number,
  max: number,
  doc: string
): SettingsField => ({ key, kind: "int", min, max, doc });

export const SETTINGS_FIELDS: readonly SettingsField[] = [
  INT("max_sessions", 1, 100_000, "sessions one agent may hold at once"),
  INT("max_agent_bytes", 1, 1_000_000_000_000, "file storage one agent may hold, in bytes"),
  INT("max_members", 1, 100_000, "addresses one agent's access list may hold"),
  INT("default_agent_limit", 1, 100_000, "agents an ordinary account may administer"),
  { key: "max_upload_bytes", kind: "json", doc: "attachment ceiling per kind: text, pdf, image, audio" },
  INT("max_thumbnail_bytes", 1, 100_000_000_000, "largest bytes a PDF thumbnail may take"),
  INT("max_tool_rounds", 1, 100, "tool rounds one turn may take before it must answer"),
  INT("message_page", 1, 1000, "transcript page size when none is asked for"),
  INT("max_message_page", 1, 10_000, "largest transcript page a caller may ask for"),
  INT("session_page", 1, 1000, "session list page size when none is asked for"),
  INT("agent_page", 1, 1000, "agent list page size when none is asked for"),
  INT("max_agent_page", 1, 10_000, "largest agent page a caller may ask for"),
  INT("voice_note_limit", 1, 100_000, "characters one voice note may carry"),
  INT("max_files_per_message", 1, 100, "attachments one message may carry"),
  INT("max_session_page", 1, 10_000, "largest session page a caller may ask for"),

  { key: "models", kind: "json", doc: "models the settings page offers: [{id,label,vision}]; empty uses MODELS" },
  { key: "default_model", kind: "string", doc: "model a new agent is seeded with; empty uses MODEL" },
  { key: "system_prompt", kind: "string", doc: "line every agent is told first; empty uses the built-in" },
  { key: "config_defaults", kind: "json", doc: `starting values for: ${SETTABLE_CONFIG_KEYS.join(", ")}` },
  { key: "mcp_catalog", kind: "json", doc: "MCP providers offered: [{id,name,url,auth,letter?,color?}]" },
  { key: "mcp_templates", kind: "json", doc: "built-in preset ids offered; empty means every preset" },
  {
    key: "field_options",
    kind: "json",
    doc: `model menus, by column: ${CHOICE_FIELD_KEYS.join(", ")} — e.g. {"voice_model":["openai/gpt-audio"]}`,
  },
];

const FIELD_BY_KEY = new Map(SETTINGS_FIELDS.map((f) => [f.key as string, f]));

/**
 * The document in force: the factory values with this deployment's overrides on top.
 *
 * `max_upload_bytes` and `config_defaults` merge per key rather than replacing, so
 * raising the PDF ceiling does not silently reset the other three.
 */
export function effectiveSettings(patch: SettingsPatch | null | undefined): DeploymentSettings {
  if (!patch) return { ...FACTORY_SETTINGS };
  return {
    ...FACTORY_SETTINGS,
    ...patch,
    max_upload_bytes: { ...FACTORY_SETTINGS.max_upload_bytes, ...(patch.max_upload_bytes ?? {}) },
    config_defaults: { ...FACTORY_SETTINGS.config_defaults, ...(patch.config_defaults ?? {}) },
    field_options: { ...FACTORY_SETTINGS.field_options, ...(patch.field_options ?? {}) },
  };
}

/** What a rejected patch says. Thrown, so every caller reports it the same way. */
export class SettingsError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function requireInt(key: string, value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new SettingsError(`${key} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

/**
 * Check an incoming patch and return the part of it that is a setting.
 *
 * Unknown keys are refused rather than ignored: a typo in `max_session` that silently
 * did nothing would look exactly like a limit that does not work, and the owner has
 * no log to find out which. `null` for a known key removes that override, which is
 * how a field is put back to the factory value.
 */
export function validateSettingsPatch(
  input: unknown,
  current: SettingsPatch
): SettingsPatch {
  if (!isObject(input)) throw new SettingsError("a settings object is required");
  const next: SettingsPatch = { ...current };

  for (const [key, value] of Object.entries(input)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) throw new SettingsError(`unknown setting: ${key}`);

    // Explicit null is "stop deciding this one", which is not the same as setting it
    // to the factory number: a later release that moves the factory value moves this
    // deployment with it again.
    if (value === null) {
      delete next[field.key];
      continue;
    }

    switch (field.key) {
      case "max_upload_bytes": {
        if (!isObject(value)) throw new SettingsError("max_upload_bytes must be an object");
        const merged = { ...effectiveSettings(next).max_upload_bytes };
        for (const [kind, bytes] of Object.entries(value)) {
          if (!(kind in FACTORY_SETTINGS.max_upload_bytes)) {
            throw new SettingsError(`unknown upload kind: ${kind}`);
          }
          merged[kind as keyof UploadLimits] = requireInt(
            `max_upload_bytes.${kind}`,
            bytes,
            1,
            100_000_000_000
          );
        }
        next.max_upload_bytes = merged;
        break;
      }
      case "models": {
        if (!Array.isArray(value)) throw new SettingsError("models must be an array");
        next.models = value.map((m, i) => {
          if (!isObject(m)) throw new SettingsError(`models[${i}] must be an object`);
          const id = String(m.id ?? "").trim();
          if (!id) throw new SettingsError(`models[${i}].id is required`);
          const label = String(m.label ?? id).trim() || id;
          // Absent means yes, as in `MODELS`: only a model that cannot be sent an
          // image has to say so.
          return { id, label, vision: m.vision === undefined ? true : !!m.vision };
        });
        break;
      }
      case "mcp_catalog": {
        if (!Array.isArray(value)) throw new SettingsError("mcp_catalog must be an array");
        next.mcp_catalog = value.map((entry, i) => {
          if (!isObject(entry)) throw new SettingsError(`mcp_catalog[${i}] must be an object`);
          const id = String(entry.id ?? "").trim();
          const name = String(entry.name ?? "").trim();
          const url = String(entry.url ?? "").trim();
          const auth = String(entry.auth ?? "oauth").trim();
          if (!id || !name || !url) {
            throw new SettingsError(`mcp_catalog[${i}] needs an id, a name and a url`);
          }
          if (auth !== "none" && auth !== "headers" && auth !== "oauth") {
            throw new SettingsError(`mcp_catalog[${i}].auth must be none, headers or oauth`);
          }
          const out: McpCatalogEntry = { id, name, url, auth };
          if (entry.letter !== undefined) out.letter = String(entry.letter).trim().slice(0, 1);
          if (entry.color !== undefined) out.color = String(entry.color).trim();
          return out;
        });
        break;
      }
      case "field_options": {
        if (!isObject(value)) throw new SettingsError("field_options must be an object");
        const merged: Record<string, string[]> = { ...effectiveSettings(next).field_options };
        for (const [column, ids] of Object.entries(value)) {
          if (!(CHOICE_FIELD_KEYS as readonly string[]).includes(column)) {
            throw new SettingsError(
              `field_options.${column} is not a choice field; one of: ${CHOICE_FIELD_KEYS.join(", ")}`
            );
          }
          if (ids === null) {
            delete merged[column];
            continue;
          }
          if (!Array.isArray(ids)) {
            throw new SettingsError(`field_options.${column} must be an array`);
          }
          const cleaned = ids.map((id) => String(id).trim()).filter(Boolean);
          for (const id of cleaned) {
            // Same shape check the meta route applies: a provider id, not prose.
            if (!/^[\w.-]+\/[\w.\-:]+$/.test(id)) {
              throw new SettingsError(`not an OpenRouter model id: ${id}`);
            }
          }
          merged[column] = [...new Set(cleaned)];
        }
        next.field_options = merged;
        break;
      }
      case "mcp_templates": {
        if (!Array.isArray(value)) throw new SettingsError("mcp_templates must be an array");
        next.mcp_templates = value.map((id) => String(id).trim()).filter(Boolean);
        break;
      }
      case "config_defaults": {
        if (!isObject(value)) throw new SettingsError("config_defaults must be an object");
        const merged: Record<string, unknown> = { ...effectiveSettings(next).config_defaults };
        for (const [column, setting] of Object.entries(value)) {
          if (!(SETTABLE_CONFIG_KEYS as readonly string[]).includes(column)) {
            throw new SettingsError(
              `config_defaults.${column} is not a settable column; one of: ${SETTABLE_CONFIG_KEYS.join(", ")}`
            );
          }
          if (setting === null) {
            delete merged[column];
            continue;
          }
          merged[column] = validateConfigDefault(column as SettableConfigKey, setting);
        }
        next.config_defaults = merged as Partial<Pick<Config, SettableConfigKey>>;
        break;
      }
      case "default_model":
      case "system_prompt": {
        if (typeof value !== "string") throw new SettingsError(`${key} must be a string`);
        next[field.key] = value;
        break;
      }
      default: {
        next[field.key] = requireInt(key, value, field.min ?? 1, field.max ?? Number.MAX_SAFE_INTEGER) as never;
      }
    }
  }

  // A page default above its own ceiling would clamp to the ceiling on every read,
  // which reads as the default being ignored. Refuse instead of silently winning.
  const merged = effectiveSettings(next);
  if (merged.message_page > merged.max_message_page) {
    throw new SettingsError("message_page cannot exceed max_message_page");
  }
  if (merged.agent_page > merged.max_agent_page) {
    throw new SettingsError("agent_page cannot exceed max_agent_page");
  }
  if (merged.session_page > merged.max_session_page) {
    throw new SettingsError("session_page cannot exceed max_session_page");
  }

  return next;
}

/** One config column's starting value, checked the way the agent's own settings route checks it. */
function validateConfigDefault(column: SettableConfigKey, value: unknown): number | string {
  if (column === "temperature") {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 2) {
      throw new SettingsError("config_defaults.temperature must be between 0 and 2");
    }
    return n;
  }
  if (column === "max_tokens") return requireInt(column, value, 0, 1_000_000);
  if (column === "context_messages") return requireInt(column, value, 0, 10_000);
  if (column === "reasoning_effort") {
    const effort = String(value);
    if (!["off", "low", "medium", "high"].includes(effort)) {
      throw new SettingsError("config_defaults.reasoning_effort must be off, low, medium or high");
    }
    return effort;
  }
  if (column.startsWith("cap_")) {
    // Stored as 0/1: SQLite has no boolean, and the column is an INTEGER.
    if (typeof value === "boolean") return value ? 1 : 0;
    return requireInt(column, value, 0, 1);
  }
  // The three model columns. An id typed in is not checked against a catalogue —
  // same reasoning as `models`: the built-in choices are a starting point, not a limit.
  const id = String(value).trim();
  if (!id) throw new SettingsError(`config_defaults.${column} cannot be blank`);
  return id;
}

/** Read a stored patch back, tolerating the row never having been written. */
export function parseSettingsPatch(json: string): SettingsPatch {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return isObject(parsed) ? (parsed as SettingsPatch) : {};
  } catch {
    // A document nobody can read is not worth failing every request over; the factory
    // values are a working deployment, which is more than a 500 on every route is.
    return {};
  }
}

/**
 * How long a cached copy of the settings may be trusted, in milliseconds.
 *
 * The document is read on paths that run per turn and per upload, and it lives in one
 * Durable Object, so reading it every time would put an RPC hop in front of every
 * message this deployment answers. Ten seconds is short enough that a change made in
 * the admin CLI is in force before the owner has finished reading the confirmation,
 * and long enough that a busy isolate reads it once rather than hundreds of times.
 *
 * The cost of the staleness is bounded and one-directional: for up to ten seconds an
 * object may enforce the old ceiling. Nothing here is a security boundary — the
 * identity gates are elsewhere — so an extra upload against a lowered limit is the
 * worst case, and it corrects itself.
 */
const SETTINGS_TTL = 10_000;

/**
 * Per-isolate cache. One deployment per isolate, so one slot; module scope survives
 * across requests in the same isolate, which is exactly the lifetime wanted here.
 */
let cached: { at: number; value: DeploymentSettings } | null = null;

/** The one directory object, by the name every other caller uses. */
function directoryStub(env: Env) {
  return env.AgentDirectory.get(env.AgentDirectory.idFromName("root"));
}

/**
 * The deployment's settings, cached for `SETTINGS_TTL`.
 *
 * Use this everywhere a ceiling or a default is needed. It never throws: a directory
 * that cannot be reached yields the factory values, because a deployment running on
 * its shipped defaults is a working deployment and a 500 on every route is not.
 */
export async function deploymentSettings(env: Env): Promise<DeploymentSettings> {
  const now = Date.now();
  if (cached && now - cached.at < SETTINGS_TTL) return cached.value;
  try {
    const value = await directoryStub(env).settings();
    cached = { at: now, value };
    return value;
  } catch {
    const value = cached?.value ?? { ...FACTORY_SETTINGS };
    cached = { at: now, value };
    return value;
  }
}

/**
 * Drop the cached copy, so the next read goes to the directory.
 *
 * Called by the write route: the owner who just changed a limit is the one caller who
 * should never see the old value, and it costs one read.
 */
export function forgetCachedSettings(): void {
  cached = null;
}
