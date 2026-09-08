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
} from "@/lib/agent";

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
      <span className="block text-[14px] font-semibold leading-[1.43]">{field.label}</span>
      <span className="text-muted block text-[12px] font-light leading-[1.33]">{field.hint}</span>
      <input
        type={field.secret && !masked ? "password" : "text"}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => masked && onChange("")}
        className="bg-field placeholder:text-faint mt-2 w-full rounded-[16px] px-4 py-3 text-[14px] outline-none"
      />
    </label>
  );
}

export default function Capabilities() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Credentials save on a timer so a PATCH does not fire on every keystroke.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/config");
      const payload = (await res.json().catch(() => null)) as
        | { config: Config; capabilities: Capability[]; error?: string }
        | null;
      if (!res.ok || !payload) {
        setError(payload?.error ?? `Request failed with ${res.status}.`);
        return;
      }
      setConfig(payload.config);
      setCapabilities(payload.capabilities);
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
    const payload = (await res.json().catch(() => null)) as
      | { config: Config; error?: string }
      | null;
    if (!res.ok || !payload) {
      setError(payload?.error ?? "Could not save. The agent Worker may be unreachable.");
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
          <h1 className="text-[32px] font-[650] leading-[1.2]">Capabilities.</h1>
          <span className="text-faint text-[12px] leading-[1.33]">{saving ? "Saving…" : "Saved"}</span>
        </div>
        <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
          What the agent can do beyond writing text. Applies to every session.
        </p>

        {error && (
          <div className="bg-canvas-soft border-hairline-soft mt-8 rounded-[16px] border px-5 py-4 text-[14px] leading-[1.43]">
            {error}
          </div>
        )}

        {!config && !error && (
          <p className="text-muted py-16 text-[14px] leading-[1.43]">Loading capabilities…</p>
        )}

        {config && (
          <div className="mt-8">
            {capabilities.map((capability) => {
              const on = !!config[capability.flag];
              const ready = capabilityReady(capability, config);
              return (
                <section key={capability.id} className="border-hairline-soft border-t py-7">
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <h2 className="text-[16px] font-semibold leading-[1.38]">{capability.label}</h2>
                      <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
                        {capability.summary}
                      </p>
                    </div>
                    <Toggle on={on} onChange={(v) => set({ [capability.flag]: v ? 1 : 0 })} />
                  </div>

                  {on && (
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

                      <p className="text-faint text-[12px] leading-[1.33]">
                        {capability.note}
                        {capability.tools.length > 0 && (
                          <>
                            {" "}
                            Tools: {capability.tools.join(", ")}.
                          </>
                        )}
                      </p>

                      {!ready && (
                        <p className="bg-canvas-soft rounded-[16px] px-4 py-3 text-[12px] leading-[1.33]">
                          On, but not usable yet — fill in every field above.
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
