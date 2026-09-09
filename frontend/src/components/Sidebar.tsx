"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Settings, SlidersHorizontal, X } from "lucide-react";
import type { SessionRow } from "@/lib/agent";
import { formatDate } from "@/lib/format";

/** How long typing has to settle before the list is filtered. */
const SEARCH_DEBOUNCE_MS = 200;

export function Sidebar({
  sessions,
  selected,
  onSelect,
  onCreate,
  onDelete,
  open,
  onClose,
  onHome,
}: {
  sessions: SessionRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  /** Whether the drawer is showing. Only meaningful below the md breakpoint. */
  open: boolean;
  onClose: () => void;
  /** Close the open session and show the welcome screen. */
  onHome: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  /** The session the delete dialog is asking about, if it is open. */
  const [confirming, setConfirming] = useState<SessionRow | null>(null);
  // Filtering trails the keystrokes, so a fast typist re-renders the list once
  // rather than once per character.
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // A destructive dialog has to be as easy to leave as to open.
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  const visible = useMemo(() => {
    const needle = debounced.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(needle));
  }, [sessions, debounced]);

  return (
    <>
      {/* On a phone the sidebar is a drawer, so the page behind it needs a way out. */}
      {open && (
        <button
          onClick={onClose}
          aria-label="Close sessions"
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
        />
      )}

      <aside
        className={`border-hairline-soft bg-canvas fixed inset-y-0 left-0 z-40 flex h-full w-72 max-w-[85vw] shrink-0 flex-col border-r transition-transform md:static md:z-auto md:max-w-none md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
          <button
            onClick={() => {
              onHome();
              onClose();
            }}
            title="Home"
            className="min-w-0 text-left"
          >
            <div className="text-2xl font-[650] leading-[1.25]">Baby.</div>
            <div className="text-muted text-[14px] font-light leading-[1.43]">
              Cloud Agent
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-2">
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
            <button
              onClick={onClose}
              aria-label="Close sessions"
              className="text-muted hover:bg-canvas-soft hover:text-ink flex h-9 w-9 items-center justify-center rounded-full transition md:hidden"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="px-4 pb-3">
          <div className="bg-field flex h-10 items-center gap-2 rounded-[16px] px-3">
            <Search
              size={16}
              strokeWidth={1.75}
              className="text-faint shrink-0"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions"
              aria-label="Search sessions"
              className="placeholder:text-faint text-ink min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-muted hover:text-ink flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-20">
          {sessions.length === 0 && (
            <p className="text-muted px-2 py-10 text-center text-[14px] leading-[1.43]">
              No sessions yet.
            </p>
          )}
          {sessions.length > 0 && visible.length === 0 && (
            <p className="text-muted px-2 py-10 text-center text-[14px] leading-[1.43]">
              No sessions match “{debounced.trim()}”.
            </p>
          )}
          {visible.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-2 rounded-[16px] px-4 py-3 transition ${
                selected === s.id ? "bg-canvas-soft" : "hover:bg-canvas-soft/60"
              }`}
            >
              <button
                onClick={() => {
                  onSelect(s.id);
                  onClose();
                }}
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
                onClick={() => setConfirming(s)}
                title={`Delete ${s.title}`}
                aria-label={`Delete ${s.title}`}
                className="text-muted hover:bg-canvas hover:text-ink flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[16px] leading-none opacity-100 transition md:opacity-0 md:group-hover:opacity-100"
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

      {confirming && (
        <ConfirmDelete
          session={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            onDelete(confirming.id);
            setConfirming(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Deleting a session takes everything it holds and cannot be undone, so it is asked
 * rather than done. The consequences are named plainly, and the way out is the easier
 * of the two choices to reach: the backdrop, the Escape key, or Cancel.
 *
 * A Telegram session is worth its own sentence. What is deleted here is this side of
 * the conversation; the chat itself belongs to Telegram and keeps its messages, and
 * someone who deletes a session expecting the chat to go with it has been misled.
 */
function ConfirmDelete({
  session,
  onCancel,
  onConfirm,
}: {
  session: SessionRow;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const telegram = session.source === "telegram";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <button
        onClick={onCancel}
        aria-label="Keep session"
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        className="border-hairline bg-canvas relative w-full max-w-sm rounded-[20px] border p-6 shadow-xl"
      >
        <h2
          id="confirm-delete-title"
          className="text-ink text-[18px] font-[650] leading-[1.35]"
        >
          Delete “{session.title}”?
        </h2>
        <p className="text-muted mt-2 text-[14px] leading-[1.5]">
          Its messages, files, and stored data will be deleted permanently. This
          can’t be undone.
        </p>
        {telegram && (
          <p className="text-muted mt-2 text-[14px] leading-[1.5]">
            Messages in the Telegram chat aren’t deleted. The bot starts a new
            session the next time someone writes there.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            // Focus starts on the way out, not on the deletion: a stray Return should
            // keep the session, never take it.
            autoFocus
            className="border-hairline text-ink hover:bg-canvas-soft rounded-full border px-4 py-2 text-[14px] font-medium transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="bg-ink text-on-primary rounded-full px-4 py-2 text-[14px] font-medium transition hover:opacity-85"
          >
            Delete session
          </button>
        </div>
      </div>
    </div>
  );
}
