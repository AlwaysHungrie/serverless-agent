"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings, SlidersHorizontal } from "lucide-react";
import type { SessionRow } from "@/lib/agent";
import { formatDate } from "@/lib/format";

export function Sidebar({
  sessions,
  selected,
  onSelect,
  onCreate,
  onDelete,
}: {
  sessions: SessionRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <aside className="border-hairline-soft bg-canvas relative flex h-full w-72 shrink-0 flex-col border-r">
      <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
        <div className="min-w-0">
          <div className="text-2xl font-[650] leading-[1.25]">Agent.</div>
          <div className="text-muted text-[14px] font-light leading-[1.43]">
            One Durable Object each.
          </div>
        </div>
        <button
          onClick={async () => {
            setBusy(true);
            await onCreate();
            setBusy(false);
          }}
          disabled={busy}
          className="bg-ink text-on-primary h-9 shrink-0 rounded-full px-4 text-[14px] font-semibold transition hover:opacity-85 disabled:opacity-40"
        >
          New
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-6">
        {sessions.length === 0 && (
          <p className="text-muted px-2 py-10 text-center text-[14px] leading-[1.43]">
            No sessions yet.
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-2 rounded-[16px] px-4 py-3 transition ${
              selected === s.id ? "bg-canvas-soft" : "hover:bg-canvas-soft/60"
            }`}
          >
            <button
              onClick={() => onSelect(s.id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="truncate text-[16px] font-semibold leading-[1.38]">
                {s.title}
              </div>
              <div className="text-faint tnum truncate text-[12px] leading-[1.33]">
                {formatDate(s.created_at)}
              </div>
            </button>
            <button
              onClick={() => onDelete(s.id)}
              title="Delete session and its Durable Object storage"
              aria-label="Delete session"
              className="text-muted hover:bg-canvas hover:text-ink flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[16px] leading-none opacity-0 transition group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="absolute right-4 bottom-4 flex items-center gap-2">
        <Link
          href="/capabilities"
          title="Capabilities"
          aria-label="Capabilities"
          className="border-hairline bg-canvas text-ink hover:bg-canvas-soft flex h-11 w-11 items-center justify-center rounded-full border shadow-sm transition"
        >
          <SlidersHorizontal size={18} strokeWidth={1.75} />
        </Link>
        <Link
          href="/settings"
          title="Settings"
          aria-label="Settings"
          className="bg-ink text-on-primary flex h-11 w-11 items-center justify-center rounded-full shadow-lg transition hover:opacity-85"
        >
          <Settings size={18} strokeWidth={1.75} />
        </Link>
      </div>
    </aside>
  );
}
