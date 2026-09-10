"use client";

import { useEffect, useState } from "react";
import { Lock, LockOpen, Plus, X } from "lucide-react";
import { ChipList, Field, Toggle } from "@/components/CapabilitySection";
import { MCP_PRESETS } from "@/components/McpPresets";
import {
  EMPTY_META,
  type AgentRow,
  type Capability,
  type CapabilityField,
  type McpAuth,
  type MetaMcpServer,
  type MetaSettings,
  type MetaTunableKey,
  type ModelOption,
  type ReasoningEffort,
} from "@/lib/agent";

/**
 * Meta settings: the settings of an agent's settings.
 *
 * Everything here answers "what should this agent be" rather than "what is it set to
 * now" — which models it may be switched between at all, what its settings and
 * capabilities start out holding, which of them it may change for itself, and which
 * MCP templates and servers belong to it.
 *
 * It is reached in two places and nowhere else: the second step of the create dialog,
 * and a dialog on the home page. Never from the agent's own pages — those are for
 * running an agent, and a setting shown in both would read as one more setting rather
 * than as the thing deciding it.
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
 * A setting that may or may not have a default at all.
 *
 * The switch is the distinction that matters: "no default" leaves the agent's value
 * alone when the defaults are applied, which is not the same as defaulting it to
 * whatever the factory value happens to be today.
 */
function Defaulted({
  label,
  on,
  onToggle,
  children,
}: {
  label: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[14px] font-semibold leading-[1.43]">
          {label}
        </span>
        <Toggle on={on} onChange={onToggle} />
      </div>
      {on && <div className="mt-3">{children}</div>}
    </div>
  );
}

/**
 * A section that could only have been decided while the agent was being created.
 *
 * It stays on screen rather than disappearing: what the agent was set up with is
 * worth seeing, and a section that vanishes after creation reads as a thing you
 * imagined. The overlay is what says it is no longer yours to move.
 */
function Frozen({
  frozen,
  reason,
  children,
}: {
  frozen: boolean;
  reason: string;
  children: React.ReactNode;
}) {
  if (!frozen) return <>{children}</>;
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none select-none blur-sm">
        {children}
      </div>
      <div className="bg-canvas/30 absolute inset-0 flex items-center justify-center rounded-[16px] px-4">
        <span className="text-ink px-4 py-2 text-center text-[12px] leading-[1.33]">
          {reason}
        </span>
      </div>
    </div>
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

/* ----------------------------------------------------------------- form -- */

export function MetaSettingsForm({
  meta,
  onChange,
  models,
  capabilities,
  creation,
}: {
  meta: MetaSettings;
  onChange: (next: MetaSettings) => void;
  models: ModelOption[];
  capabilities: Capability[];
  /** True in the create dialog, where the creation-only settings are still open. */
  creation: boolean;
}) {
  const patch = (next: Partial<MetaSettings>) => onChange({ ...meta, ...next });

  /** Set or clear the default for one tuning setting. */
  const setDefault = (key: MetaTunableKey, value: unknown | undefined) => {
    const defaults = { ...meta.defaults } as Record<string, unknown>;
    if (value === undefined) delete defaults[key];
    else defaults[key] = value;
    patch({ defaults: defaults as MetaSettings["defaults"] });
  };

  const setCapability = (
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
  const has = (key: MetaTunableKey) => defaults[key] !== undefined;

  /**
   * The models the default may be chosen from: whatever the list above holds, or the
   * shipped catalogue while it is empty. An id typed in by hand has no label of its
   * own, so it is shown as itself.
   */
  const offeredModels = meta.models.length
    ? meta.models.map(
        (id) =>
          models.find((m) => m.id === id) ?? { id, label: id, vision: true },
      )
    : models;

  /** What a fixed-choice field may be set to: the widened list, or what it ships with. */
  const optionsFor = (field: CapabilityField): string[] => {
    const widened = meta.field_options[String(field.key)] ?? [];
    return widened.length ? widened : (field.options ?? []).map((o) => o.value);
  };

  const setFieldOptions = (field: CapabilityField, values: string[]) =>
    patch({
      field_options: { ...meta.field_options, [String(field.key)]: values },
    });

  const frozenReason = "Can only be set while the agent is being created.";

  return (
    <div>
      <Section
        title="Model options"
        hint="Enter any valid Openrouter model slug. An empty list will offer all default options to the user."
      >
        <IdList
          value={meta.models}
          onChange={(models) => patch({ models })}
          placeholder="deepseek/deepseek-v4-flash"
          suggestions={models.map((m) => ({ id: m.id, label: m.label }))}
          suggestionsHint="Default options"
        />
      </Section>

      <Section title="Model" {...lock("model")}>
        <Frozen frozen={!creation} reason={frozenReason}>
          <Defaulted
            label="Set a default model"
            on={has("model")}
            onToggle={(v) =>
              setDefault("model", v ? (models[0]?.id ?? "") : undefined)
            }
          >
            <select
              value={defaults.model ?? ""}
              onChange={(e) => setDefault("model", e.target.value)}
              className={`${input} appearance-none`}
            >
              {offeredModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Defaulted>
        </Frozen>
      </Section>

      <Section
        title="Custom instructions"
        hint="Base instructions given to agent in every chat"
        {...lock("system_prompt")}
      >
        <Frozen frozen={!creation} reason={frozenReason}>
          <Defaulted
            label="Set default instructions"
            on={has("system_prompt")}
            onToggle={(v) => setDefault("system_prompt", v ? "" : undefined)}
          >
            <textarea
              rows={3}
              maxLength={4000}
              value={defaults.system_prompt ?? ""}
              onChange={(e) => setDefault("system_prompt", e.target.value)}
              placeholder="Answer in short paragraphs. Show code before explaining it."
              className={`${input} resize-y`}
            />
          </Defaulted>
        </Frozen>
      </Section>

      <Section
        title="Extended reasoning"
        hint="How long the agent thinks before it answers."
        {...lock("reasoning_effort")}
      >
        <Frozen frozen={!creation} reason={frozenReason}>
          <Defaulted
            label="Set a default effort"
            on={has("reasoning_effort")}
            onToggle={(v) =>
              setDefault("reasoning_effort", v ? "off" : undefined)
            }
          >
            <select
              value={defaults.reasoning_effort ?? "off"}
              onChange={(e) =>
                setDefault(
                  "reasoning_effort",
                  e.target.value as ReasoningEffort,
                )
              }
              className={`${input} appearance-none`}
            >
              {REASONING.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Defaulted>
        </Frozen>
      </Section>

      <Section
        title="Creativity"
        hint="Low keeps answers literal. High makes them varied."
        {...lock("temperature")}
      >
        <Frozen frozen={!creation} reason={frozenReason}>
          <Defaulted
            label="Set a default"
            on={has("temperature")}
            onToggle={(v) => setDefault("temperature", v ? 0.7 : undefined)}
          >
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={defaults.temperature ?? 0.7}
                onChange={(e) =>
                  setDefault("temperature", Number(e.target.value))
                }
                className="accent-ink h-1 flex-1 cursor-pointer"
              />
              <span className="tnum text-muted w-16 shrink-0 text-right text-[14px]">
                {(defaults.temperature ?? 0.7).toFixed(1)}
              </span>
            </div>
          </Defaulted>
        </Frozen>
      </Section>

      <Section
        title="Reply length cap"
        hint="How long a single reply can run."
        {...lock("max_tokens")}
      >
        <Frozen frozen={!creation} reason={frozenReason}>
          <Defaulted
            label="Set a default cap"
            on={has("max_tokens")}
            onToggle={(v) => setDefault("max_tokens", v ? 0 : undefined)}
          >
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={8000}
                step={250}
                value={defaults.max_tokens ?? 0}
                onChange={(e) =>
                  setDefault("max_tokens", Number(e.target.value))
                }
                className="accent-ink h-1 flex-1 cursor-pointer"
              />
              <span className="tnum text-muted w-24 shrink-0 text-right text-[14px]">
                {defaults.max_tokens
                  ? `${defaults.max_tokens} tokens`
                  : "No cap"}
              </span>
            </div>
          </Defaulted>
        </Frozen>
      </Section>

      <Section
        title="Context window"
        hint="How much of the chat the agent sees each turn."
        {...lock("context_messages")}
      >
        <Frozen frozen={!creation} reason={frozenReason}>
          <Defaulted
            label="Set a default"
            on={has("context_messages")}
            onToggle={(v) => setDefault("context_messages", v ? 0 : undefined)}
          >
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={100}
                step={2}
                value={defaults.context_messages ?? 0}
                onChange={(e) =>
                  setDefault("context_messages", Number(e.target.value))
                }
                className="accent-ink h-1 shrink flex-1 cursor-pointer"
              />
              <span className="tnum text-muted w-24 shrink-0 text-right text-[14px]">
                {defaults.context_messages
                  ? `Last ${defaults.context_messages}`
                  : "Full history"}
              </span>
            </div>
          </Defaulted>
        </Frozen>
      </Section>

      <Section
        title="OpenRouter"
        hint="The key every model call is billed to."
        {...lock("openrouter_api_key")}
      >
        <Frozen frozen={!creation} reason={frozenReason}>
          <Defaulted
            label="Set a default key"
            on={has("openrouter_api_key")}
            onToggle={(v) =>
              setDefault("openrouter_api_key", v ? "" : undefined)
            }
          >
            <Field
              field={OPENROUTER_KEY}
              value={defaults.openrouter_api_key ?? ""}
              onChange={(v) => setDefault("openrouter_api_key", v)}
            />
          </Defaulted>
        </Frozen>
      </Section>

      <Section
        title="Capabilities"
        hint="Internal and external capabilities the agent arrives with, and their default values."
      >
        <div className="space-y-2">
          {capabilities.map((capability) => {
            const entry = meta.capabilities[capability.id] ?? {};
            const on = entry.enabled ?? false;
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
                        onChange={(v) =>
                          setCapability(capability.id, { enabled: v })
                        }
                      />
                    )}
                  </span>
                </div>
                {capability.fields.length > 0 &&
                  (on || capability.alwaysOn) && (
                    <div className="mt-3 space-y-3">
                      {capability.fields.map((field) => {
                        const key = String(field.key);
                        const values = optionsFor(field);
                        return (
                          <div key={key} className="space-y-3">
                            {/* A fixed choice is only fixed in the agent's own pages.
                              Here the list itself is the setting, and the field
                              below picks this agent's default out of it. */}
                            {field.options && (
                              <IdList
                                label={`${field.label} options`}
                                hint="Type any OpenRouter id. Empty offers the ones this deployment ships with."
                                value={meta.field_options[key] ?? []}
                                onChange={(next) =>
                                  setFieldOptions(field, next)
                                }
                                placeholder="google/gemini-3-pro-image"
                                suggestions={(field.options ?? []).map((o) => ({
                                  id: o.value,
                                  label: o.label,
                                }))}
                                emptyNote="Empty offers the shipped choices."
                              />
                            )}
                            <Field
                              field={
                                field.options
                                  ? {
                                      ...field,
                                      options: values.map((value) => ({
                                        value,
                                        label:
                                          field.options?.find(
                                            (o) => o.value === value,
                                          )?.label ?? value,
                                      })),
                                    }
                                  : field
                              }
                              value={entry.fields?.[key] ?? ""}
                              onChange={(v) =>
                                setCapability(capability.id, {
                                  field: { key, value: v },
                                })
                              }
                              bordered
                            />
                          </div>
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
        hint="Which provider templates this agent is offered on its capabilities page. None ticked offers all of them."
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
        title="Default MCP servers"
        hint="Servers the agent is created with. An OAuth server still has to be connected once from the capabilities page; its headers are filled in for you."
      >
        <Frozen
          frozen={!creation}
          reason="Can only be added while the agent is being created — a server added later would collide by name."
        >
          <McpDefaults
            servers={meta.mcp.servers}
            onChange={(servers) => patch({ mcp: { ...meta.mcp, servers } })}
          />
        </Frozen>
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
  const [models, setModels] = useState<ModelOption[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = `/api/agents/${encodeURIComponent(agent.id)}/meta`;

  useEffect(() => {
    void (async () => {
      const res = await fetch(base, { cache: "no-store" });
      const payload = (await res.json().catch(() => null)) as {
        meta: MetaSettings;
        models: ModelOption[];
        capabilities: Capability[];
        error?: string;
      } | null;
      if (!res.ok || !payload) {
        setError(payload?.error ?? "Couldn't load meta settings.");
        return;
      }
      setMeta({ ...EMPTY_META, ...payload.meta });
      setModels(payload.models);
      setCapabilities(payload.capabilities);
    })();
  }, [base]);

  /** Save the document, optionally pushing it onto the agent in the same call. */
  const save = async (apply: boolean) => {
    if (!meta) return;
    setBusy(true);
    const res = await fetch(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...meta, apply }),
    });
    setBusy(false);
    const payload = (await res.json().catch(() => null)) as {
      meta?: MetaSettings;
      added?: string[];
      error?: string;
    } | null;
    if (!res.ok || !payload?.meta) {
      setError(payload?.error ?? "Couldn't save meta settings.");
      return;
    }
    setMeta(payload.meta);
    setError(null);
    setNote(
      apply
        ? `Defaults applied to ${agent.name}.` +
            (payload.added?.length ? ` Added ${payload.added.join(", ")}.` : "")
        : "Saved.",
    );
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
              Set the defaults for {agent.name}, and choose what its owner can
              change. A locked setting will not be shown to the owner for
              configuration.
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

        {meta && (
          <div className="mt-4">
            <MetaSettingsForm
              meta={meta}
              onChange={setMeta}
              models={models}
              capabilities={capabilities}
              creation={false}
            />

            <div className="border-hairline-soft flex items-center justify-between gap-3 border-t pt-5">
              <span className="text-faint text-[12px] leading-[1.33]">
                {busy ? "Saving…" : (note ?? "")}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => void save(false)}
                  disabled={busy}
                  className="border-hairline text-ink hover:bg-canvas-soft h-10 rounded-full border px-5 text-[14px] font-semibold transition disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => void save(true)}
                  disabled={busy}
                  className="bg-ink text-on-primary h-10 rounded-full px-5 text-[14px] font-semibold transition hover:opacity-85 disabled:opacity-40"
                >
                  Save &amp; apply now
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
          Add a default server
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
