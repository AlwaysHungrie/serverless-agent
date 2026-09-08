"use client";

import { useEffect, useState } from "react";
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

/**
 * A list field: one entry per line in the config, a set of chips on screen. Entries
 * are typed in and committed with Enter, so a whitelist is built one name at a time
 * rather than as a block of text to get the separators right in.
 */
function ListField({
  field,
  value,
  onChange,
  bordered = false,
}: {
  field: CapabilityField;
  value: string;
  onChange: (v: string) => void;
  bordered?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const entries = value
    .split("\n")
    .map((e) => e.trim())
    .filter((e) => e !== "");

  const add = (raw: string) => {
    const entry = raw.trim();
    // A duplicate is a no-op rather than an error: nothing about the list changes.
    if (!entry || entries.includes(entry)) {
      setDraft("");
      return;
    }
    onChange([...entries, entry].join("\n"));
    setDraft("");
  };

  return (
    <div>
      <span className="block text-[14px] font-semibold leading-[1.43]">
        {field.label}
      </span>
      <span className="text-muted block text-[12px] font-light leading-[1.33]">
        {field.hint}
      </span>

      {entries.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {entries.map((entry) => (
            <span
              key={entry}
              className={`bg-field text-ink flex items-center gap-2 rounded-full py-1.5 pr-2 pl-3 text-[13px] leading-[1.35] ${
                bordered ? "border-hairline border" : ""
              }`}
            >
              <span className="max-w-[220px] truncate">{entry}</span>
              <button
                onClick={() =>
                  onChange(entries.filter((e) => e !== entry).join("\n"))
                }
                aria-label={`Remove ${entry}`}
                className="text-muted hover:text-ink flex h-5 w-5 items-center justify-center rounded-full"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          placeholder={field.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => add(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
            if (e.key === "Escape") setDraft("");
          }}
          aria-label={field.label}
          className={`bg-field placeholder:text-faint min-w-0 flex-1 rounded-[16px] px-4 py-3 text-[14px] outline-none ${
            bordered ? "border-hairline border" : ""
          }`}
        />
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => add(draft)}
          disabled={draft.trim() === ""}
          className="border-hairline text-ink hover:bg-canvas-soft shrink-0 rounded-[16px] border px-5 text-[14px] font-semibold transition disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {entries.length === 0 && (
        <p className="text-faint mt-2 text-[12px] leading-[1.33]">
          *Empty list allows everyone.
        </p>
      )}
    </div>
  );
}

export function Field({
  field,
  value,
  onChange,
  bordered = false,
}: {
  field: CapabilityField;
  value: string;
  /** Commit a new value. Called when the field is left, not on every keystroke. */
  onChange: (v: string) => void;
  /** Outline the inputs, for a section drawn on a tint rather than on the canvas. */
  bordered?: boolean;
}) {
  // The field holds its own text while it is being typed into. Saving is what
  // reloads the config, and a saved secret reads back as the mask — so a
  // save-per-keystroke would replace the half-typed token with dots. Committing on
  // blur keeps what is on screen the thing the user typed.
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  // A stored secret arrives masked. Focusing clears it, so typing replaces the key
  // and leaving it alone keeps the one already saved.
  const masked = field.secret && draft === SECRET_MASK;

  const commit = (next: string) => {
    setDraft(next);
    if (next !== value) onChange(next);
  };

  // A list is a set of entries, not a line of text, so it has an editor of its own.
  if (field.list)
    return (
      <ListField
        field={field}
        value={value}
        onChange={onChange}
        bordered={bordered}
      />
    );

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
          className={`bg-field text-ink mt-2 w-full appearance-none rounded-[16px] px-4 py-3 text-[14px] outline-none ${
            bordered ? "border-hairline border" : ""
          }`}
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
          value={draft}
          placeholder={field.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => {
            setFocused(true);
            if (masked) setDraft("");
          }}
          onBlur={() => {
            setFocused(false);
            // An untouched secret is left alone: the mask means "keep the key".
            if (field.secret && draft === "") {
              setDraft(value);
              return;
            }
            commit(draft.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(value);
              e.currentTarget.blur();
            }
          }}
          className={`bg-field placeholder:text-faint mt-2 w-full rounded-[16px] px-4 py-3 text-[14px] outline-none ${
            bordered ? "border-hairline border" : ""
          }`}
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
  tinted = false,
}: {
  capability: Capability;
  config: Config;
  set: (patch: Partial<Config>, wait?: number) => void;
  /** The switch is dead: something else has to change before this can be used. */
  blocked?: boolean;
  blockedNote?: React.ReactNode;
  /** Wash the section in Telegram's blue, the way a Telegram chat is marked. */
  tinted?: boolean;
}) {
  const on = !!config[capability.flag];
  const ready = capabilityReady(capability, config);
  return (
    <section
      className={`${
        tinted
          ? "mb-2 rounded-[24px] bg-gradient-to-b from-[#229ED9]/18 to-transparent px-5 py-6"
          : "border-hairline-soft border-t py-7"
      } ${blocked ? "opacity-50" : ""}`}
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
        <p className="text-muted mt-4 text-[12px] leading-[1.33]">
          {blockedNote}
        </p>
      )}

      {on && !blocked && (
        <div className="mt-5 space-y-5">
          {capability.fields.map((field) => (
            <Field
              key={String(field.key)}
              field={field}
              value={String(config[field.key] ?? "")}
              onChange={(v) => set({ [field.key]: v })}
              bordered={tinted}
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
