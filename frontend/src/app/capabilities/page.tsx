"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  capabilityReady,
  SECRET_MASK,
  type Capability,
  type CapabilityField,
  type Config,
  type ModelOption,
} from "@/lib/agent";

function Toggle({
  on,
  disabled = false,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${
        on ? "bg-ink" : "bg-field"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <span
        className={`bg-canvas absolute top-1 h-5 w-5 rounded-full shadow-sm transition-all ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: CapabilityField;
  value: string;
  onChange: (v: string) => void;
}) {
  // A stored secret arrives masked. Focusing clears it, so typing replaces the key
  // and leaving it alone keeps the one already saved.
  const masked = field.secret && value === SECRET_MASK;
  return (
    <label className="block">
      <span className="block text-[14px] font-semibold leading-[1.43]">
        {field.label}
      </span>
      <span className="text-muted block text-[12px] font-light leading-[1.33]">
        {field.hint}
      </span>
      {field.options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-field text-ink mt-2 w-full appearance-none rounded-[16px] px-4 py-3 text-[14px] outline-none"
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.secret && !masked ? "password" : "text"}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => masked && onChange("")}
          className="bg-field placeholder:text-faint mt-2 w-full rounded-[16px] px-4 py-3 text-[14px] outline-none"
        />
      )}
    </label>
  );
}

export default function Capabilities() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Credentials save on a timer so a PATCH does not fire on every keystroke.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/config");
      const payload = (await res.json().catch(() => null)) as {
        config: Config;
        capabilities: Capability[];
        models: ModelOption[];
        error?: string;
      } | null;
      if (!res.ok || !payload) {
        setError(payload?.error ?? "Couldn't load your capabilities. Refresh the page to try again.");
        return;
      }
      setConfig(payload.config);
      setCapabilities(payload.capabilities);
      setModels(payload.models);
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
    const payload = (await res.json().catch(() => null)) as {
      config: Config;
      error?: string;
    } | null;
    if (!res.ok || !payload) {
      setError(
        payload?.error ??
          "Couldn't save. The agent isn't responding. Try the switch again.",
      );
      return;
    }
    setConfig(payload.config);
    setError(null);
  };

  /** Apply locally right away, then persist — immediately, or debounced for text. */
  const set = (patch: Partial<Config>, wait = 0) => {
    setConfig((c) => (c ? { ...c, ...patch } : c));
    if (debounce.current) clearTimeout(debounce.current);
    if (wait === 0) {
      void save(patch);
      return;
    }
    debounce.current = setTimeout(() => void save(patch), wait);
  };

  const model = models.find((m) => m.id === config?.model) ?? null;

  return (
    <div className="bg-canvas text-ink min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-5 py-10 md:px-8 md:py-14">
        <Link
          href="/"
          className="text-muted hover:text-ink mb-10 inline-flex items-center gap-2 text-[14px] transition"
        >
          <ArrowLeft size={16} strokeWidth={1.75} />
          Sessions
        </Link>

        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-[32px] font-[650] leading-[1.2]">
            Capabilities.
          </h1>
          <span className="text-faint text-[12px] leading-[1.33]">
            {saving ? "Saving…" : "Saved"}
          </span>
        </div>
        <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
          Choose what the agent can do besides write. Applies to every
          session.
        </p>

        {error && (
          <div className="bg-canvas-soft border-hairline-soft mt-8 rounded-[16px] border px-5 py-4 text-[14px] leading-[1.43]">
            {error}
          </div>
        )}

        {!config && !error && (
          <p className="text-muted py-16 text-[14px] leading-[1.43]">
            Loading your capabilities…
          </p>
        )}

        {config && (
          <div className="mt-8">
            {capabilities.map((capability) => {
              const on = !!config[capability.flag];
              const ready = capabilityReady(capability, config);
              // Images only reach a model that can see them, so the switch is dead
              // until the chosen model is one of those.
              const blocked = capability.id === "vision" && !model?.vision;
              return (
                <section
                  key={capability.id}
                  className={`border-hairline-soft border-t py-7 ${
                    blocked ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <h2 className="text-[16px] font-semibold leading-[1.38]">
                        {capability.label}
                        {blocked && (
                          <span className="text-faint ml-2 text-[12px] font-normal">
                            Unavailable
                          </span>
                        )}
                      </h2>
                      <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
                        {capability.summary}
                      </p>
                    </div>
                    <Toggle
                      on={on && !blocked}
                      disabled={blocked}
                      onChange={(v) => set({ [capability.flag]: v ? 1 : 0 })}
                    />
                  </div>

                  {blocked && (
                    <p className="text-muted mt-4 text-[12px] leading-[1.33]">
                      {model?.label ?? "This model"} can&rsquo;t see images. Pick a
                      model that can in{" "}
                      <Link href="/settings" className="text-ink underline">
                        Settings
                      </Link>
                      .
                    </p>
                  )}

                  {on && !blocked && (
                    <div className="mt-5 space-y-5">
                      {capability.fields.length > 0 &&
                        capability.fields.map((field) => (
                          <Field
                            key={String(field.key)}
                            field={field}
                            value={String(config[field.key] ?? "")}
                            onChange={(v) => set({ [field.key]: v }, 700)}
                          />
                        ))}

                      {capability.note && (
                        <p className="text-faint text-[12px] leading-[1.33]">
                          {capability.note}
                        </p>
                      )}

                      {!ready && (
                        <p className="bg-canvas-soft rounded-[16px] px-4 py-3 text-[12px] leading-[1.33]">
                          Fill in the fields above to start using this.
                        </p>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
