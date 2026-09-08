"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Menu, Pencil, X } from "lucide-react";
import type { Summary } from "@/lib/agent";
import { formatCount, formatDate } from "@/lib/format";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 text-right">
      <div className="text-faint text-[12px] leading-[1.33]">{label}</div>
      <div className="text-ink tnum text-[20px] font-[650] leading-[1.3]">
        {value}
      </div>
      {hint && (
        <div className="text-muted tnum text-[12px] leading-[1.33]">{hint}</div>
      )}
    </div>
  );
}

/**
 * The session's own facts: its name, when it was created and how much it has been
 * used. The title is edited here in place — renaming is the one thing about a
 * session you change from the conversation you are looking at.
 *
 * The model is an app-wide setting now, so it lives in the settings page, not here.
 * Cloudflare's costs are deliberately not shown — they cannot be measured
 * from inside the object, and their analytics lag. See
 * docs/cloudflare-durable-object-costs.md.
 */
export function SessionHeader({
  title,
  createdAt,
  summary,
  onRename,
  onOpenSidebar,
}: {
  title: string;
  createdAt: number | null;
  summary: Summary | null;
  onRename: (title: string) => Promise<void> | void;
  onOpenSidebar: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const input = useRef<HTMLInputElement>(null);

  // A rename elsewhere — or switching sessions — wins over an abandoned edit.
  useEffect(() => {
    setEditing(false);
    setValue(title);
  }, [title]);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = async () => {
    const next = value.trim();
    setEditing(false);
    if (!next || next === title) {
      setValue(title);
      return;
    }
    await onRename(next);
  };

  return (
    <header className="border-hairline-soft bg-canvas border-b">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4 px-5 pt-5 pb-4 md:px-8 md:pt-6 md:pb-5">
        <button
          onClick={onOpenSidebar}
          aria-label="Open sessions"
          className="text-ink hover:bg-canvas-soft -ml-1 mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition md:hidden"
        >
          <Menu size={20} strokeWidth={1.75} />
        </button>

        <div className="mr-auto min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center">
              <input
                ref={input}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commit();
                  if (e.key === "Escape") {
                    setValue(title);
                    setEditing(false);
                  }
                }}
                onBlur={() => void commit()}
                aria-label="Session title"
                className="mr-2 bg-field text-ink focus:ring-ink min-w-0 max-w-64 flex-1 rounded-[12px] px-3 py-1 text-xl font-[650] leading-tight outline-none focus:ring-2 md:text-xl"
              />
              {/* Pressed before blur can fire, so the click still counts. */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void commit()}
                aria-label="Save title"
                className="text-muted hover:bg-canvas-soft hover:text-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition"
              >
                <Check size={16} strokeWidth={2} />
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setValue(title);
                  setEditing(false);
                }}
                aria-label="Cancel rename"
                className="text-muted hover:bg-canvas-soft hover:text-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <div className="group flex items-center gap-2">
              <button
                onClick={() => setEditing(true)}
                title="Rename session"
                className="min-w-0 truncate text-left text-xl font-[650] leading-tight md:text-2xl"
              >
                {title}
              </button>
              <button
                onClick={() => setEditing(true)}
                aria-label="Rename session"
                className="text-muted hover:bg-canvas-soft hover:text-ink flex h-7 w-7 shrink-0 items-center justify-center rounded-full opacity-100 transition md:opacity-0 md:group-hover:opacity-100"
              >
                <Pencil size={14} strokeWidth={1.75} />
              </button>
            </div>
          )}
          <div className="text-muted truncate text-[14px] font-light leading-[1.43]">
            {formatDate(createdAt)}
          </div>
        </div>

        <div className="hidden md:block">
          <Stat label="Messages" value={formatCount(summary?.messages ?? 0)} />
        </div>
      </div>
    </header>
  );
}
