"use client";

import { useState } from "react";
import type { SessionRow } from "@/lib/agent";

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
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Sessions</div>
          <div className="text-[11px] text-zinc-500">one Durable Object each</div>
        </div>
        <button
          onClick={async () => {
            setBusy(true);
            await onCreate();
            setBusy(false);
          }}
          disabled={busy}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {sessions.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-zinc-600">
            No sessions yet. Create one to spin up a Durable Object.
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group mb-1 flex items-center gap-1 rounded-md px-2 py-2 text-sm transition ${
              selected === s.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900"
            }`}
          >
            <button onClick={() => onSelect(s.id)} className="min-w-0 flex-1 text-left">
              <div className="truncate">{s.title}</div>
              <div className="truncate font-mono text-[10px] text-zinc-600">{s.id}</div>
            </button>
            <button
              onClick={() => onDelete(s.id)}
              title="Delete session and its Durable Object storage"
              className="opacity-0 transition group-hover:opacity-100 hover:text-red-400"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
