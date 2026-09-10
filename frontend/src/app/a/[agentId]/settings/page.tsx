"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { CapabilitySection, Field } from "@/components/CapabilitySection";
import type {
  AgentRow,
  Capability,
  CapabilityField,
  Config,
  ModelOption,
  ReasoningEffort,
} from "@/lib/agent";

/**
 * The OpenRouter key is not a capability's credential — it is what every model call
 * is billed to, so the agent has one of its own and one agent's spend never lands on
 * another's. Described here in the shape `Field` already knows how to draw, so a
 * pasted key behaves exactly like every other secret on the capabilities page.
 */
const OPENROUTER_KEY: CapabilityField = {
  key: "openrouter_api_key",
  secret: true,
  required: true,
  placeholder: "sk-or-v1-…",
};

const REASONING: { id: ReasoningEffort; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Answers right away. Cheapest." },
  { id: "low", label: "Low", hint: "Thinks briefly before answering." },
  { id: "medium", label: "Medium", hint: "Good for multi-step questions." },
  { id: "high", label: "High", hint: "Thinks hardest. Slowest and priciest." },
];

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-hairline-soft border-t py-7">
      <h2 className="text-[16px] font-semibold leading-[1.38]">{title}</h2>
      <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
        {hint}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="bg-field inline-flex rounded-full p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-full px-4 py-1.5 text-[14px] font-semibold transition ${
            value === o.id
              ? "bg-canvas text-ink shadow-sm"
              : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-ink h-1 flex-1 cursor-pointer"
      />
      <span className="tnum text-muted w-24 shrink-0 text-right text-[14px]">
        {format(value)}
      </span>
    </div>
  );
}

export default function Settings({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = use(params);
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [name, setName] = useState("");
  /** The access list as the box shows it: one address per line. */
  const [emails, setEmails] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  /** Connecting the bot is setup rather than a tool, so it is shown here, first. */
  const [telegram, setTelegram] = useState<Capability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** What OpenRouter said about the key that was last pasted. Cleared on the next save. */
  const [keyCheck, setKeyCheck] = useState<{
    ok: boolean;
    error?: string;
    label?: string;
  } | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/config`,
      );
      const payload = (await res.json().catch(() => null)) as {
        agent: AgentRow;
        config: Config;
        models: ModelOption[];
        capabilities: Capability[];
        error?: string;
      } | null;
      if (!res.ok || !payload) {
        setError(
          payload?.error ??
            "Couldn't load your settings. Refresh the page to try again.",
        );
        return;
      }
      setModels(payload.models);
      setConfig(payload.config);
      setAgent(payload.agent ?? null);
      setName(payload.agent?.name ?? "");
      setEmails(payload.agent?.allowed_emails ?? "");
      setTelegram(
        payload.capabilities.find((c) => c.id === "telegram") ?? null,
      );
    })();
  }, [agentId]);

  /** The agent's name. It is the agent itself, not one of its settings. */
  const rename = async (next: string) => {
    const cleaned = next.trim();
    if (!cleaned || cleaned === agent?.name) {
      setName(agent?.name ?? "");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: cleaned }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Couldn't rename this agent.");
      setName(agent?.name ?? "");
      return;
    }
    setAgent((a) => (a ? { ...a, name: cleaned } : a));
    setError(null);
  };

  /**
   * Who may open this agent. Your own address is added back by the Worker whatever
   * this box says: an agent you edited yourself out of would be one you could not
   * edit back, and an empty list would strand it for everyone.
   */
  const saveEmails = async (next: string) => {
    if (next.trim() === (agent?.allowed_emails ?? "").trim()) return;
    setSaving(true);
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowed_emails: next }),
    });
    setSaving(false);
    const payload = (await res.json().catch(() => null)) as
      | (AgentRow & { error?: string })
      | null;
    if (!res.ok || !payload?.id) {
      setError(payload?.error ?? "Couldn't save who can open this agent.");
      setEmails(agent?.allowed_emails ?? "");
      return;
    }
    setAgent(payload);
    // Take the stored list back: it is lowercased, de-duplicated and shorn of
    // anything that was not an address, so the box shows what is actually saved.
    setEmails(payload.allowed_emails);
    setError(null);
  };

  const save = async (patch: Partial<Config>) => {
    setSaving(true);
    const res = await fetch(
      `/api/agents/${encodeURIComponent(agentId)}/config`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    setSaving(false);
    const payload = (await res.json().catch(() => null)) as {
      config: Config;
      openrouter?: { ok: boolean; error?: string; label?: string };
      error?: string;
    } | null;
    if (!res.ok || !payload) {
      setError(
        payload?.error ??
          "Couldn't save. The agent isn't responding. Change the setting again to retry.",
      );
      return;
    }
    // Take the server's row back: it clamps values the UI could send out of range.
    setConfig(payload.config);
    // Only a save that carried a new key gets a verdict; the rest leave it alone.
    if (payload.openrouter) setKeyCheck(payload.openrouter);
    setError(null);
  };

  const set = (patch: Partial<Config>, wait = 0) => {
    setConfig((c) => (c ? { ...c, ...patch } : c));
    if (debounce.current) clearTimeout(debounce.current);
    if (wait === 0) {
      void save(patch);
      return;
    }
    debounce.current = setTimeout(() => void save(patch), wait);
  };

  return (
    <div className="bg-canvas text-ink min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-5 py-10 md:px-8 md:py-14">
        <Link
          href={`/a/${encodeURIComponent(agentId)}`}
          className="text-muted hover:text-ink mb-10 inline-flex items-center gap-2 text-[14px] transition"
        >
          <ArrowLeft size={16} strokeWidth={1.75} />
          Sessions
        </Link>

        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-[32px] font-[650] leading-[1.2]">Settings.</h1>
          <span className="text-faint text-[12px] leading-[1.33]">
            {saving ? "Saving…" : "Saved"}
          </span>
        </div>
        <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
          Configure how this agent replies to messages. To manage its
          capabilities and give it additional tools, go to{" "}
          <Link
            href={`/a/${encodeURIComponent(agentId)}/capabilities`}
            className="text-ink underline"
          >
            Capabilities
          </Link>
          .
        </p>

        {error && (
          <div className="bg-canvas-soft border-hairline-soft mt-8 rounded-[16px] border px-5 py-4 text-[14px] leading-[1.43]">
            {error}
          </div>
        )}

        {!config && !error && (
          <p className="text-muted py-16 text-[14px] leading-[1.43]">
            Loading settings…
          </p>
        )}

        {config && (
          <div className="mt-8">
            {telegram && (
              <CapabilitySection
                capability={telegram}
                config={config}
                set={set}
                tint="#229ED9"
              />
            )}

            <Row title="Model" hint="Choose which model answers you.">
              <div className="space-y-2">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => set({ model: m.id })}
                    className={`flex w-full items-center gap-3 rounded-[16px] px-5 py-4 text-left transition ${
                      config.model === m.id
                        ? "bg-canvas-soft"
                        : "hover:bg-canvas-soft/60"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-semibold leading-[1.38]">
                        {m.label}
                      </span>
                      <span className="text-faint block truncate text-[12px] leading-[1.33]">
                        {m.id}
                        {!m.vision ? " · (no vision)" : ""}
                      </span>
                    </span>
                    {config.model === m.id && (
                      <Check size={18} strokeWidth={2} className="shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </Row>

            <Row
              title="Custom instructions"
              hint="Tell the agent how to reply, every time."
            >
              <textarea
                value={config.system_prompt}
                onChange={(e) => set({ system_prompt: e.target.value }, 600)}
                rows={4}
                maxLength={4000}
                placeholder="Answer in short paragraphs. Show code before explaining it."
                className="bg-field placeholder:text-faint w-full resize-y rounded-[16px] px-5 py-4 text-[14px] leading-[1.43] outline-none"
              />
              <p className="text-faint mt-2 text-[12px] leading-[1.33]">
                {config.system_prompt.length} / 4000
              </p>
            </Row>

            <Row
              title="Extended reasoning"
              hint="Choose how long the agent thinks before it answers."
            >
              <Segmented
                options={REASONING.map((r) => ({ id: r.id, label: r.label }))}
                value={config.reasoning_effort}
                onChange={(v) => set({ reasoning_effort: v })}
              />
              <p className="text-faint mt-3 text-[12px] leading-[1.33]">
                {REASONING.find((r) => r.id === config.reasoning_effort)?.hint}
              </p>
            </Row>

            <Row
              title="Creativity"
              hint="Low keeps answers literal. High makes them varied."
            >
              <Slider
                value={config.temperature}
                min={0}
                max={2}
                step={0.1}
                format={(v) => v.toFixed(1)}
                onChange={(v) => set({ temperature: v })}
              />
            </Row>

            <Row
              title="Reply length cap"
              hint="Set how long a single reply can run."
            >
              <Slider
                value={config.max_tokens}
                min={0}
                max={8000}
                step={250}
                format={(v) => (v === 0 ? "No cap" : `${v} tokens`)}
                onChange={(v) => set({ max_tokens: v })}
              />
            </Row>

            <Row
              title="Context window"
              hint="Choose how much of the chat the agent sees each turn."
            >
              <Slider
                value={config.context_messages}
                min={0}
                max={100}
                step={2}
                format={(v) => (v === 0 ? "Full history" : `Last ${v}`)}
                onChange={(v) => set({ context_messages: v })}
              />
            </Row>

            <Row
              title="OpenRouter"
              hint="Your agent cannot function without this."
            >
              <Field
                field={OPENROUTER_KEY}
                value={config.openrouter_api_key}
                onChange={(v) => {
                  setKeyCheck(null);
                  set({ openrouter_api_key: v });
                }}
              />
              {keyCheck && (
                <p
                  className={`mt-2 text-[12px] leading-[1.33] ${
                    keyCheck.ok ? "text-muted" : "text-ink"
                  }`}
                >
                  {keyCheck.ok
                    ? `This key${keyCheck.label ? ` (${keyCheck.label})` : ""} is valid.`
                    : "Invalid key"}
                </p>
              )}
              {!config.openrouter_api_key && !keyCheck && (
                <p className="text-faint mt-2 text-[12px] leading-[1.33]">
                  A valid Openrouter API key is required.
                </p>
              )}
            </Row>

            <Row title="Name" hint="What this agent is called, everywhere">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void rename(name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    setName(agent?.name ?? "");
                    e.currentTarget.blur();
                  }
                }}
                maxLength={60}
                placeholder="New agent"
                className="bg-field placeholder:text-faint w-full rounded-[16px] px-5 py-4 text-[14px] leading-[1.43] outline-none"
              />
            </Row>

            <Row
              title="Manage access"
              hint="Comma separated, emails of user who have complete access to manage, chat and read all messages of this agent."
            >
              <textarea
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                onBlur={() => void saveEmails(emails)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEmails(agent?.allowed_emails ?? "");
                    e.currentTarget.blur();
                  }
                }}
                rows={3}
                placeholder="teammate@example.com"
                className="bg-field placeholder:text-faint w-full resize-y rounded-[16px] px-5 py-4 text-[14px] leading-[1.43] outline-none"
              />
              <p className="text-faint mt-2 text-[12px] leading-[1.33]">
                Best to keep this list empty.
              </p>
            </Row>
          </div>
        )}
      </div>
    </div>
  );
}
