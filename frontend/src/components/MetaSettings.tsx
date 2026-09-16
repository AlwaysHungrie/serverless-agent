"use client";

import { useEffect, useState } from "react";
import { Lock, LockOpen, Plus, X } from "lucide-react";
import { ChipList, Field, Toggle } from "@/components/CapabilitySection";
import { MCP_PRESETS } from "@/components/McpPresets";
import { McpServers } from "@/components/McpServers";
import {
  EMPTY_META,
  type AgentRow,
  type Capability,
  type CapabilityField,
  type Config,
  type McpAuth,
  type MetaMcpServer,
  type MetaSettings,
  type MetaTunableKey,
  type ModelChoice,
  type ModelOption,
  type ReasoningEffort,
} from "@/lib/agent";

/**
 * Meta settings: the settings page, plus the decisions the agent's owner does not get
 * to make.
 *
 * Everything the settings and capabilities pages offer is here — the tuning, the
 * capability switches and their credentials, the MCP servers — and beside each one a
 * lock, which is what the agent's own pages are missing. A locked setting disappears
 * from them, so this becomes the only place it exists. Around that sit the choices
 * that have no editor on those pages at all: which models may be offered, what a
 * fixed choice may be widened to, which MCP templates are shown.
 *
 * It is reached in two places and nowhere else: the second step of the create dialog,
 * and a dialog on the home page. Never from the agent's own pages — those are for
 * running an agent, and a lock shown in both would read as one more setting rather
 * than as the thing deciding it.
 *
 * The form has one seam, and it is not about permission. Before the agent exists
 * there is nothing to write to, so every value it collects is a *default* — what the
 * agent will start on, or nothing at all. Once it exists the values are the agent's
 * own, read and written live.
 */

const input =
  "bg-field placeholder:text-faint text-ink w-full rounded-[16px] px-4 py-3 text-[14px] outline-none";

const REASONING: ReasoningEffort[] = ["off", "low", "medium", "high"];

/** The OpenRouter key, described the way a capability describes its own fields. */
const OPENROUTER_KEY: CapabilityField = {
  key: "openrouter_api_key",
  label: "OpenRouter API key",
  hint: "Every model call this agent makes is billed to this key.",
  secret: true,
  required: false,
  placeholder: "sk-or-v1-…",
};

/* --------------------------------------------------------------- pieces -- */

/**
 * One block of the form, titled, with the lock that decides who may change what is
 * inside it.
 *
 * The lock is the point of this dialog rather than a decoration on it: a locked
 * setting disappears from the agent's own pages, so this becomes the only place it
 * exists. Sections that are not a setting — the model catalogue, the MCP templates —
 * take no lock, because there is nothing under the agent for them to hide.
 */
function Section({
  title,
  hint,
  lockKey,
  locked,
  onLock,
  children,
}: {
  title: string;
  hint?: string;
  /** The config column or capability id this section governs, if it governs one. */
  lockKey?: string;
  locked?: boolean;
  onLock?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-hairline-soft border-t py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold leading-[1.38]">{title}</p>
          {hint && (
            <p className="text-muted mt-1 text-[12px] font-light leading-[1.33]">
              {hint}
            </p>
          )}
        </div>
        {lockKey && onLock && (
          <LockButton locked={!!locked} onChange={onLock} what={title} />
        )}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function LockButton({
  locked,
  onChange,
  what,
}: {
  locked: boolean;
  onChange: (v: boolean) => void;
  what: string;
}) {
  return (
    <button
      onClick={() => onChange(!locked)}
      title={locked ? `Unlock ${what}` : `Lock ${what}`}
      aria-label={locked ? `Unlock ${what}` : `Lock ${what}`}
      aria-pressed={locked}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${
        locked
          ? "bg-ink text-on-primary"
          : "text-muted hover:bg-canvas-soft hover:text-ink"
      }`}
    >
      {locked ? (
        <Lock size={14} strokeWidth={2} />
      ) : (
        <LockOpen size={14} strokeWidth={2} />
      )}
    </button>
  );
}

/**
 * A list of model ids, typed in.
 *
 * `ChipList` is what an access list uses, and this is the same shape of thing: a set
 * of entries, added one at a time, removed by their chip. It keeps a newline-joined
 * string, which is how the config columns hold their own lists — so the conversion
 * lives here rather than spreading through the form.
 *
 * The suggestions are the ids this deployment already knows about: nobody should have
 * to retype a shipped model to keep it in the list.
 */
function IdList({
  label,
  hint,
  value,
  onChange,
  placeholder,
  suggestions,
  suggestionsHint,
  emptyNote,
}: {
  label?: string;
  hint?: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  suggestions: { id: string; label: string }[];
  suggestionsHint?: string;
  emptyNote?: string;
}) {
  const missing = suggestions.filter((s) => !value.includes(s.id));
  return (
    <div>
      <ChipList
        label={label}
        hint={hint}
        placeholder={placeholder}
        value={value.join("\n")}
        onChange={(next) =>
          onChange(
            next
              .split("\n")
              .map((id) => id.trim())
              .filter((id) => id !== ""),
          )
        }
        suggestionHint={suggestionsHint}
        emptyNote={emptyNote}
      />
      {missing.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {missing.map((s) => (
            <button
              key={s.id}
              onClick={() => onChange([...value, s.id])}
              title={s.id}
              className="border-hairline text-muted hover:border-ink hover:text-ink rounded-full border px-3 py-1 text-[12px] transition"
            >
              + {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The models an agent may be switched between: an OpenRouter id each, and whether
 * that model can be sent an image.
 *
 * Not `IdList`, because an id is not the whole answer. Nothing here can look up
 * whether an arbitrary OpenRouter model is multimodal, so whoever adds it has to say,
 * and the checkbox beside the box is where they say it. Unticked by default: most
 * models take images, and the ones that do not are the exception worth marking.
 *
 * The suggestions are the models this deployment already names, and they bring their
 * own answer with them — nobody should have to remember which of the shipped models
 * is text-only.
 */
function ModelList({
  value,
  onChange,
  catalog,
}: {
  value: ModelChoice[];
  onChange: (value: ModelChoice[]) => void;
  catalog: ModelOption[];
}) {
  const [draft, setDraft] = useState("");
  /** Whether the model being typed is one that cannot be sent an image. */
  const [blind, setBlind] = useState(false);

  const add = (id: string, vision: boolean) => {
    const entry = id.trim();
    // A duplicate is a no-op rather than an error: nothing about the list changes.
    if (entry === "" || value.some((m) => m.id === entry)) return;
    onChange([...value, { id: entry, vision }]);
  };

  const commit = () => {
    add(draft, !blind);
    setDraft("");
    setBlind(false);
  };

  const missing = catalog.filter((m) => !value.some((v) => v.id === m.id));
  const chip =
    "bg-field text-ink flex items-center gap-2 rounded-full py-1.5 pr-2 pl-3 text-[13px] leading-[1.35]";

  return (
    <div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((model) => (
            <span key={model.id} className={chip}>
              <span className="max-w-[220px] truncate">{model.id}</span>
              {!model.vision && (
                <span className="text-faint text-[11px]">(no image)</span>
              )}
              <button
                onClick={() => onChange(value.filter((m) => m.id !== model.id))}
                aria-label={`Remove ${model.id}`}
                className="text-muted hover:text-ink flex h-5 w-5 items-center justify-center rounded-full"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={`flex gap-2 ${value.length > 0 ? "mt-3" : ""}`}>
        <input
          value={draft}
          placeholder="deepseek/deepseek-v4-flash"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") setDraft("");
          }}
          aria-label="OpenRouter model id"
          className="bg-field placeholder:text-faint min-w-0 flex-1 rounded-[16px] px-4 py-3 text-[14px] outline-none"
        />
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          disabled={draft.trim() === ""}
          className="bg-canvas border-hairline text-ink hover:bg-canvas-soft shrink-0 rounded-[16px] border px-5 text-[14px] font-semibold transition disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <label className="text-muted mt-2 flex cursor-pointer items-center gap-2 text-[12px] leading-[1.33]">
        <input
          type="checkbox"
          checked={blind}
          onChange={(e) => setBlind(e.target.checked)}
          className="accent-ink h-3.5 w-3.5 cursor-pointer"
        />
        This model cannot be sent images
      </label>

      {missing.length > 0 && (
        <>
          <p className="text-faint mt-3 text-[12px] leading-[1.33]">
            Default options
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {missing.map((m) => (
              <button
                key={m.id}
                onClick={() => add(m.id, m.vision)}
                title={m.id}
                className="border-hairline text-muted hover:border-ink hover:text-ink rounded-full border px-3 py-1 text-[12px] transition"
              >
                + {m.label}
                {!m.vision && " (no image)"}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- form -- */

export function MetaSettingsForm({
  meta,
  onChange,
  models,
  capabilities,
  config,
  onConfigChange,
  agentId,
}: {
  meta: MetaSettings;
  onChange: (next: MetaSettings) => void;
  models: ModelOption[];
  capabilities: Capability[];
  /**
   * The agent's own settings, once there is an agent. Null in the create dialog,
   * where the form is collecting the values the agent will be made with instead.
   */
  config?: Config | null;
  /** Stage a change to those settings. Ignored while there is no agent. */
  onConfigChange?: (patch: Partial<Config>) => void;
  agentId?: string;
}) {
  /** Whether the settings on screen belong to an agent that exists. */
  const live = !!config && !!onConfigChange;

  const patch = (next: Partial<MetaSettings>) => onChange({ ...meta, ...next });

  /**
   * Record what a new agent should start on for one tuning setting.
   *
   * Only settings that were actually touched end up in here. A control nobody moved
   * leaves nothing behind and the agent is created on the factory value — which is
   * what the control was showing anyway, so the two never disagree.
   */
  const setDefault = (key: MetaTunableKey, value: unknown) =>
    patch({ defaults: { ...meta.defaults, [key]: value } });

  const setCapabilityDefault = (
    id: string,
    next: { enabled?: boolean; field?: { key: string; value: string } },
  ) => {
    const entry = { ...(meta.capabilities[id] ?? {}) };
    if (next.enabled !== undefined) entry.enabled = next.enabled;
    if (next.field) {
      entry.fields = { ...(entry.fields ?? {}) };
      if (next.field.value === "") delete entry.fields[next.field.key];
      else entry.fields[next.field.key] = next.field.value;
    }
    patch({ capabilities: { ...meta.capabilities, [id]: entry } });
  };

  const isLocked = (key: string) => meta.locked.includes(key);
  const setLocked = (key: string, on: boolean) =>
    patch({
      locked: on ? [...meta.locked, key] : meta.locked.filter((k) => k !== key),
    });
  /** The lock props a section needs, so every section wires it the same way. */
  const lock = (key: string) => ({
    lockKey: key,
    locked: isLocked(key),
    onLock: (v: boolean) => setLocked(key, v),
  });

  const defaults = meta.defaults;

  /* The two sides of the seam. Every editor below reads through `valueOf` and writes
     through `setValue`, so the form is written once and the live agent's settings and
     the values a new one is created with go through the same controls.

     `valueOf` returns undefined only before the agent exists and before the control
     has been touched; each editor supplies the factory value to show in that case, so
     what is on screen is what the agent would be created with either way. */

  /** One tuning setting as it stands: the agent's own value, or its chosen default. */
  const valueOf = <K extends MetaTunableKey>(key: K): Config[K] | undefined =>
    live ? config[key] : (defaults[key] as Config[K] | undefined);

  const setValue = (key: MetaTunableKey, value: unknown) => {
    if (live) onConfigChange({ [key]: value } as Partial<Config>);
    else setDefault(key, value);
  };

  /** Whether a capability is switched on, and the switch that changes that. */
  const capabilityOn = (capability: Capability) =>
    live
      ? !!config[capability.flag]
      : (meta.capabilities[capability.id]?.enabled ?? false);

  const setCapabilityOn = (capability: Capability, on: boolean) => {
    if (live)
      onConfigChange({ [capability.flag]: on ? 1 : 0 } as Partial<Config>);
    else setCapabilityDefault(capability.id, { enabled: on });
  };

  const fieldValue = (capability: Capability, key: string) =>
    live
      ? String(config[key as keyof Config] ?? "")
      : (meta.capabilities[capability.id]?.fields?.[key] ?? "");

  const setFieldValue = (
    capability: Capability,
    key: string,
    value: string,
  ) => {
    if (live) onConfigChange({ [key]: value } as Partial<Config>);
    else setCapabilityDefault(capability.id, { field: { key, value } });
  };

  /**
   * The models this agent may be switched between: whatever the list above holds, or
   * the deployment's catalogue while it is empty. An id typed in by hand has no label
   * of its own, so it is shown as itself.
   */
  const offeredModels: ModelOption[] = meta.models.length
    ? meta.models.map(({ id, vision }) => ({
        id,
        label: models.find((m) => m.id === id)?.label ?? id,
        vision,
      }))
    : models;

  /** What a fixed-choice field may be set to: the widened list, or what it ships with. */
  const optionsFor = (field: CapabilityField): string[] => {
    const widened = meta.field_options[String(field.key)] ?? [];
    return widened.length ? widened : (field.options ?? []).map((o) => o.value);
  };

  /** Every fixed-choice field any capability declares: the image and audio models. */
  const choiceFields = capabilities.flatMap((c) =>
    c.fields.filter((f) => f.options && f.options.length > 0),
  );

  const setFieldOptions = (field: CapabilityField, values: string[]) =>
    patch({
      field_options: { ...meta.field_options, [String(field.key)]: values },
    });

  /** The editor a capability field gets, with its choices widened to this agent's. */
  const fieldFor = (field: CapabilityField): CapabilityField => {
    if (!field.options) return field;
    return {
      ...field,
      options: optionsFor(field).map((value) => ({
        value,
        label: field.options?.find((o) => o.value === value)?.label ?? value,
      })),
    };
  };

  return (
    <div>
      <Section
        title="OpenRouter"
        hint="The key every model call is billed to."
        {...lock("openrouter_api_key")}
      >
        <Field
          field={OPENROUTER_KEY}
          value={valueOf("openrouter_api_key") ?? ""}
          onChange={(v) => setValue("openrouter_api_key", v)}
        />
      </Section>

      <Section
        title="Model options"
        hint="Enter any valid Openrouter model slug. An empty list will offer all default options to the user."
      >
        <ModelList
          value={meta.models}
          onChange={(models) => patch({ models })}
          catalog={models}
        />
      </Section>

      {/* The choice fields — the image and transcription models — are lists of
          OpenRouter ids like the one above, so they are edited beside it rather
          than inside the capability that happens to use them. The capability
          keeps the part that is its own: which of these it is on. */}
      {choiceFields.map((field) => (
        <Section
          key={String(field.key)}
          title={`${field.label} options`}
          hint="Enter any valid Openrouter model slug. An empty list will offer all default options to the user."
        >
          <IdList
            value={meta.field_options[String(field.key)] ?? []}
            onChange={(next) => setFieldOptions(field, next)}
            placeholder={field.options?.[0]?.value}
            suggestions={(field.options ?? []).map((o) => ({
              id: o.value,
              label: o.label,
            }))}
            suggestionsHint="Default options"
          />
        </Section>
      ))}

      <Section title="Model" {...lock("model")}>
        <select
          value={valueOf("model") ?? offeredModels[0]?.id ?? ""}
          onChange={(e) => setValue("model", e.target.value)}
          className={`${input} appearance-none`}
        >
          {offeredModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {!m.vision ? " (no image)" : ""}
            </option>
          ))}
        </select>
      </Section>

      <Section
        title="Custom instructions"
        hint="Base instructions given to agent in every chat"
        {...lock("system_prompt")}
      >
        <textarea
          rows={3}
          maxLength={4000}
          value={valueOf("system_prompt") ?? ""}
          onChange={(e) => setValue("system_prompt", e.target.value)}
          placeholder="Answer in short paragraphs. Show code before explaining it."
          className={`${input} resize-y`}
        />
      </Section>

      <Section
        title="Extended reasoning"
        hint="How long the agent thinks before it answers."
        {...lock("reasoning_effort")}
      >
        <select
          value={valueOf("reasoning_effort") ?? "off"}
          onChange={(e) =>
            setValue("reasoning_effort", e.target.value as ReasoningEffort)
          }
          className={`${input} appearance-none`}
        >
          {REASONING.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Section>

      <Section
        title="Creativity"
        hint="Low keeps answers literal. High makes them varied."
        {...lock("temperature")}
      >
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={valueOf("temperature") ?? 0.7}
            onChange={(e) => setValue("temperature", Number(e.target.value))}
            className="accent-ink h-1 flex-1 cursor-pointer"
          />
          <span className="tnum text-muted w-16 shrink-0 text-right text-[14px]">
            {(valueOf("temperature") ?? 0.7).toFixed(1)}
          </span>
        </div>
      </Section>

      <Section
        title="Reply length cap"
        hint="How long a single reply can run."
        {...lock("max_tokens")}
      >
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={0}
            max={8000}
            step={250}
            value={valueOf("max_tokens") ?? 0}
            onChange={(e) => setValue("max_tokens", Number(e.target.value))}
            className="accent-ink h-1 flex-1 cursor-pointer"
          />
          <span className="tnum text-muted w-24 shrink-0 text-right text-[14px]">
            {valueOf("max_tokens")
              ? `${valueOf("max_tokens")} tokens`
              : "No cap"}
          </span>
        </div>
      </Section>

      <Section
        title="Context window"
        hint="How much of the chat the agent sees each turn."
        {...lock("context_messages")}
      >
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={0}
            max={100}
            step={2}
            value={valueOf("context_messages") ?? 0}
            onChange={(e) =>
              setValue("context_messages", Number(e.target.value))
            }
            className="accent-ink h-1 shrink flex-1 cursor-pointer"
          />
          <span className="tnum text-muted w-24 shrink-0 text-right text-[14px]">
            {valueOf("context_messages")
              ? `Last ${valueOf("context_messages")}`
              : "Full history"}
          </span>
        </div>
      </Section>

      <Section
        title="Capabilities"
        hint="What this agent can do besides write, and the credentials each one needs."
      >
        <div className="space-y-2">
          {capabilities.map((capability) => {
            const on = capabilityOn(capability);
            const locked = isLocked(capability.id);
            return (
              <div
                key={capability.id}
                className="bg-canvas-soft rounded-[16px] px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold leading-[1.43]">
                      {capability.label}
                    </span>
                    <span className="text-faint block text-[12px] leading-[1.33]">
                      {capability.alwaysOn
                        ? "Always on; its own configuration decides what it does."
                        : capability.summary}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <LockButton
                      locked={locked}
                      onChange={(v) => setLocked(capability.id, v)}
                      what={capability.label}
                    />
                    {!capability.alwaysOn && (
                      <Toggle
                        on={on}
                        onChange={(v) => setCapabilityOn(capability, v)}
                      />
                    )}
                  </span>
                </div>
                {capability.fields.length > 0 &&
                  (on || capability.alwaysOn) && (
                    <div className="mt-3 space-y-3">
                      {capability.fields.map((field) => {
                        const key = String(field.key);
                        return (
                          <Field
                            key={key}
                            field={fieldFor(field)}
                            value={fieldValue(capability, key)}
                            onChange={(v) => setFieldValue(capability, key, v)}
                            bordered
                          />
                        );
                      })}
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="MCP templates"
        hint="MCP templates provide easier way to the user to add an MCP server. If none are selected, all of them are presented to the user."
      >
        <div className="flex flex-wrap gap-2">
          {MCP_PRESETS.map((preset) => {
            const on = meta.mcp.templates.includes(preset.id);
            return (
              <button
                key={preset.id}
                onClick={() =>
                  patch({
                    mcp: {
                      ...meta.mcp,
                      templates: on
                        ? meta.mcp.templates.filter((id) => id !== preset.id)
                        : [...meta.mcp.templates, preset.id],
                    },
                  })
                }
                className={`flex items-center gap-2 rounded-[12px] border px-3 py-2 text-[13px] font-semibold transition ${
                  on
                    ? "border-ink bg-canvas-soft"
                    : "border-hairline hover:border-ink"
                }`}
              >
                {preset.logo}
                {preset.name}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="MCP servers"
        hint={
          live
            ? "External capabilities this agent can call."
            : "External capabilities the agent is created with."
        }
      >
        {/* Whether the owner may build the list out themselves, or only use what it
            already holds. Off is for an agent handed to somebody else: they can still
            switch a server off, choose which of its tools it may call and approve its
            OAuth — what it is for, rather than what it is. */}
        <div className="bg-canvas-soft mb-3 flex items-center justify-between gap-3 rounded-[16px] px-4 py-3">
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold leading-[1.43]">
              Allow adding more MCP servers
            </span>
          </span>
          <Toggle
            on={meta.mcp.user_servers}
            onChange={(v) => patch({ mcp: { ...meta.mcp, user_servers: v } })}
          />
        </div>

        {/* A live agent's servers are the real ones — connected, synced, with tokens
            behind them — so this is the same editor the capabilities page uses, doing
            the same things to the same rows. Before the agent exists there is nothing
            to connect to yet, so all that can be written down is what to create. */}
        {live && agentId ? (
          <McpServers agentId={agentId} meta />
        ) : (
          <McpDefaults
            servers={meta.mcp.servers}
            onChange={(servers) => patch({ mcp: { ...meta.mcp, servers } })}
          />
        )}
      </Section>
    </div>
  );
}

/* --------------------------------------------------------------- dialog -- */

export function MetaSettingsDialog({
  agent,
  onClose,
}: {
  agent: AgentRow;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<MetaSettings | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  /**
   * The settings changed since the dialog opened, and nothing else.
   *
   * Sending the whole config back would mean sending every secret as its mask, which
   * is harmless but says "keep all of these" about keys nobody touched. A patch says
   * what was actually meant.
   */
  const [changed, setChanged] = useState<Partial<Config>>({});
  const [models, setModels] = useState<ModelOption[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const id = encodeURIComponent(agent.id);
  const base = `/api/agents/${id}/meta`;

  useEffect(() => {
    void (async () => {
      const [metaRes, configRes] = await Promise.all([
        fetch(base, { cache: "no-store" }),
        fetch(`/api/agents/${id}/config`, { cache: "no-store" }),
      ]);
      const payload = (await metaRes.json().catch(() => null)) as {
        meta: MetaSettings;
        models: ModelOption[];
        capabilities: Capability[];
        error?: string;
      } | null;
      const live = (await configRes.json().catch(() => null)) as {
        config: Config;
        error?: string;
      } | null;
      if (!metaRes.ok || !payload || !configRes.ok || !live?.config) {
        setError(
          payload?.error ?? live?.error ?? "Couldn't load meta settings.",
        );
        return;
      }
      setMeta({ ...EMPTY_META, ...payload.meta });
      setConfig(live.config);
      setModels(payload.models);
      setCapabilities(payload.capabilities);
    })();
  }, [base, id]);

  /** Show the change straight away, and remember it for the save. */
  const editConfig = (patch: Partial<Config>) => {
    setConfig((c) => (c ? { ...c, ...patch } : c));
    setChanged((c) => ({ ...c, ...patch }));
  };

  /**
   * Save the locks and the option lists, and the settings themselves, in one request.
   *
   * They go together because they decide each other: a model added to the list is
   * what makes the model beside it selectable, and a lock is what says whose setting
   * the value below it is. The Worker writes the document first for that reason.
   */
  const save = async () => {
    if (!meta) return;
    setBusy(true);
    const res = await fetch(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...meta, config: changed }),
    });
    setBusy(false);
    const payload = (await res.json().catch(() => null)) as {
      meta?: MetaSettings;
      config?: Config;
      error?: string;
    } | null;
    if (!res.ok || !payload?.meta) {
      setError(payload?.error ?? "Couldn't save meta settings.");
      return;
    }
    setMeta(payload.meta);
    if (payload.config) setConfig(payload.config);
    setChanged({});
    setError(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-5 py-10"
      onClick={onClose}
    >
      <div
        className="bg-canvas text-ink w-full max-w-lg rounded-[20px] px-6 py-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[18px] font-semibold leading-[1.38]">
              Meta settings
            </p>
            <p className="text-muted mt-1 text-[12px] font-light leading-[1.33]">
              Default settings for {agent.name}, can be changed later. A locked
              setting will not be shown to the owner and can only be changed
              from Admin Settings.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-ink shrink-0 transition"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {error && (
          <p className="bg-canvas-soft border-hairline-soft mt-4 rounded-[16px] border px-4 py-3 text-[13px] leading-[1.33]">
            {error}
          </p>
        )}

        {!meta && !error && (
          <p className="text-muted py-10 text-[14px] leading-[1.43]">
            Loading meta settings…
          </p>
        )}

        {meta && config && (
          <div className="mt-4">
            <MetaSettingsForm
              meta={meta}
              onChange={setMeta}
              models={models}
              capabilities={capabilities}
              config={config}
              onConfigChange={editConfig}
              agentId={agent.id}
            />

            <div className="border-hairline-soft flex items-center justify-between gap-3 border-t pt-5">
              <span />
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  disabled={busy}
                  className="border-hairline text-ink hover:bg-canvas-soft h-10 rounded-full border px-5 text-[14px] font-semibold transition disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void save()}
                  disabled={busy}
                  className="bg-ink text-on-primary h-10 rounded-full px-5 text-[14px] font-semibold transition hover:opacity-85 disabled:opacity-40"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ mcp servers -- */

/** The default-server list: name, URL, how it authenticates, and its headers. */
function McpDefaults({
  servers,
  onChange,
}: {
  servers: MetaMcpServer[];
  onChange: (servers: MetaMcpServer[]) => void;
}) {
  const edit = (i: number, patch: Partial<MetaMcpServer>) =>
    onChange(servers.map((s, n) => (n === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-3">
      {servers.map((server, i) => (
        <div
          key={i}
          className="bg-canvas-soft space-y-3 rounded-[16px] px-4 py-4"
        >
          <div className="flex items-center gap-2">
            <input
              value={server.name}
              placeholder="Notion"
              aria-label="Server name"
              onChange={(e) => edit(i, { name: e.target.value })}
              className={input}
            />
            <button
              onClick={() => onChange(servers.filter((_, n) => n !== i))}
              aria-label={`Remove ${server.name || "server"}`}
              className="text-muted hover:text-ink shrink-0 transition"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
          <input
            value={server.url}
            placeholder="https://mcp.notion.com/mcp"
            aria-label="Server URL"
            onChange={(e) => edit(i, { url: e.target.value })}
            className={input}
          />
          <select
            value={server.auth}
            onChange={(e) => edit(i, { auth: e.target.value as McpAuth })}
            aria-label="Authentication"
            className={`${input} appearance-none`}
          >
            <option value="none">No auth</option>
            <option value="headers">Headers</option>
            <option value="oauth">OAuth</option>
          </select>
          <HeaderRows
            headers={server.headers}
            onChange={(headers) => edit(i, { headers })}
          />
        </div>
      ))}

      <button
        onClick={() =>
          onChange([
            ...servers,
            { name: "", url: "", auth: "oauth", headers: {} },
          ])
        }
        className="border-ink-soft/20 text-ink hover:bg-canvas-soft w-full rounded-[16px] border border-dashed py-3 text-[13px] font-semibold transition"
      >
        <span className="inline-flex items-center gap-2">
          <Plus size={14} strokeWidth={2} />
          Add a server
        </span>
      </button>
    </div>
  );
}

/**
 * Default headers, as pairs.
 *
 * The document holds them as an object, but they are edited as a list: an object
 * with a blank key is not a thing anyone can type towards. The rows are local state
 * for that reason — a half-typed pair has to survive until it has a name.
 */
function HeaderRows({
  headers,
  onChange,
}: {
  headers: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState<[string, string][]>(() => {
    const pairs = Object.entries(headers) as [string, string][];
    return pairs.length > 0 ? pairs : [["", ""]];
  });

  const write = (next: [string, string][]) => {
    setRows(next);
    onChange(
      Object.fromEntries(next.filter(([k]) => k.trim() !== "")) as Record<
        string,
        string
      >,
    );
  };

  return (
    <div className="space-y-2">
      {rows.map(([key, value], i) => (
        <div key={i} className="flex gap-2">
          <input
            value={key}
            placeholder="Authorization"
            aria-label="Header name"
            onChange={(e) => {
              const next = [...rows];
              next[i] = [e.target.value, value];
              write(next);
            }}
            className={input}
          />
          <input
            value={value}
            placeholder="Bearer …"
            aria-label="Header value"
            onChange={(e) => {
              const next = [...rows];
              next[i] = [key, e.target.value];
              write(next);
            }}
            className={input}
          />
        </div>
      ))}
      <button
        onClick={() => setRows([...rows, ["", ""]])}
        className="text-muted hover:text-ink text-[12px] font-semibold transition"
      >
        + Add header
      </button>
    </div>
  );
}
