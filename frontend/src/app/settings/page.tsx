"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import type { Config, ModelOption, ReasoningEffort } from "@/lib/agent";

const REASONING: { id: ReasoningEffort; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Answers right away. Cheapest." },
  { id: "low", label: "Low", hint: "Thinks briefly before answering." },
  { id: "medium", label: "Medium", hint: "Good for multi-step questions." },
  { id: "high", label: "High", hint: "Thinks hardest. Slowest and priciest." },
];

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="border-hairline-soft border-t py-7">
      <h2 className="text-[16px] font-semibold leading-[1.38]">{title}</h2>
      <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">{hint}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-ink" : "bg-field"}`}
    >
      <span
        className={`bg-canvas absolute top-1 h-5 w-5 rounded-full shadow-sm transition-all ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
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
            value === o.id ? "bg-canvas text-ink shadow-sm" : "text-muted hover:text-ink"
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
      <span className="tnum text-muted w-24 shrink-0 text-right text-[14px]">{format(value)}</span>
    </div>
  );
}

export default function Settings() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/config");
      const payload = (await res.json().catch(() => null)) as
        | { config: Config; models: ModelOption[]; error?: string }
        | null;
      if (!res.ok || !payload) {
        setError(payload?.error ?? "Couldn't load your settings. Refresh the page to try again.");
        return;
      }
      setModels(payload.models);
      setConfig(payload.config);
    })();
  }, []);

  const save = async (patch: Partial<Config>) => {
    setSaving(true);
    const res = await fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    const payload = (await res.json().catch(() => null)) as { config: Config; error?: string } | null;
    if (!res.ok || !payload) {
      setError(payload?.error ?? "Couldn't save. The agent isn't responding. Change the setting again to retry.");
      return;
    }
    // Take the server's row back: it clamps values the UI could send out of range.
    setConfig(payload.config);
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
      <div className="mx-auto w-full max-w-2xl px-8 py-14">
        <Link
          href="/"
          className="text-muted hover:text-ink mb-10 inline-flex items-center gap-2 text-[14px] transition"
        >
          <ArrowLeft size={16} strokeWidth={1.75} />
          Sessions
        </Link>

        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-[32px] font-[650] leading-[1.2]">Settings.</h1>
          <span className="text-faint text-[12px] leading-[1.33]">{saving ? "Saving…" : "Saved"}</span>
        </div>
        <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
          Change how the agent writes in every session. To give it tools, go to{" "}
          <Link href="/capabilities" className="text-ink underline">Capabilities</Link>.
        </p>

        {error && (
          <div className="bg-canvas-soft border-hairline-soft mt-8 rounded-[16px] border px-5 py-4 text-[14px] leading-[1.43]">
            {error}
          </div>
        )}

        {!config && !error && (
          <p className="text-muted py-16 text-[14px] leading-[1.43]">Loading settings…</p>
        )}

        {config && (
          <div className="mt-8">
            <Row title="Model" hint="Choose which model answers you.">
              <div className="space-y-2">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => set({ model: m.id })}
                    className={`flex w-full items-center gap-3 rounded-[16px] px-5 py-4 text-left transition ${
                      config.model === m.id ? "bg-canvas-soft" : "hover:bg-canvas-soft/60"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-semibold leading-[1.38]">
                        {m.label}
                      </span>
                      <span className="text-faint block truncate text-[12px] leading-[1.33]">
                        {m.id}
                        {m.vision ? " · sees images" : ""}
                      </span>
                    </span>
                    {config.model === m.id && <Check size={18} strokeWidth={2} className="shrink-0" />}
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
              title="Auto-title sessions"
              hint="Name each session from your first message."
            >
              <div className="flex items-center justify-between gap-6">
                <span className="text-muted text-[14px]">
                  {config.auto_title ? "On" : "Off"}
                </span>
                <Toggle on={!!config.auto_title} onChange={(v) => set({ auto_title: v ? 1 : 0 })} />
              </div>
            </Row>
          </div>
        )}
      </div>
    </div>
  );
}
