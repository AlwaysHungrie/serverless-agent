"use client";

import Link from "next/link";
import {
  capabilityReady,
  SECRET_MASK,
  type Capability,
  type CapabilityField,
  type Config,
} from "@/lib/agent";

export function Toggle({
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

export function Field({
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

/**
 * One capability: its switch, and the credentials it needs once it is on. Shared by
 * the capabilities page and by Settings, which shows Telegram at the top because
 * connecting the bot is setup, not a tool the agent calls.
 */
export function CapabilitySection({
  capability,
  config,
  set,
  blocked = false,
  blockedNote,
}: {
  capability: Capability;
  config: Config;
  set: (patch: Partial<Config>, wait?: number) => void;
  /** The switch is dead: something else has to change before this can be used. */
  blocked?: boolean;
  blockedNote?: React.ReactNode;
}) {
  const on = !!config[capability.flag];
  const ready = capabilityReady(capability, config);
  return (
    <section
      className={`border-hairline-soft border-t py-7 ${blocked ? "opacity-50" : ""}`}
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

      {blocked && blockedNote && (
        <p className="text-muted mt-4 text-[12px] leading-[1.33]">{blockedNote}</p>
      )}

      {on && !blocked && (
        <div className="mt-5 space-y-5">
          {capability.fields.map((field) => (
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
}

/** Kept next to the sections that render it, so both pages agree on the wording. */
export function visionBlockedNote(modelLabel: string) {
  return (
    <>
      {modelLabel} can&rsquo;t see images. Pick a model that can in{" "}
      <Link href="/settings" className="text-ink underline">
        Settings
      </Link>
      .
    </>
  );
}
