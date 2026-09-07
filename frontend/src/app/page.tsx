"use client";

import { useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { CostHeader } from "@/components/CostHeader";
import { Sidebar } from "@/components/Sidebar";
import type { Metrics, SessionRow, StoredMessage } from "@/lib/agent";

export default function Home() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Keyed by session so switching sessions shows a loader instead of the previous
  // session's transcript, without having to null it out on every selection change.
  const [loaded, setLoaded] = useState<{ sessionId: string; messages: StoredMessage[] } | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Reads a proxy response, surfacing the Worker-unreachable message as an error. */
  const readJson = useCallback(async <T,>(res: Response): Promise<T | null> => {
    const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !payload) {
      setError(payload?.error ?? `Request failed with ${res.status}.`);
      return null;
    }
    setError(null);
    return payload;
  }, []);

  const loadSessions = useCallback(async () => {
    const payload = await readJson<{ sessions: SessionRow[] }>(await fetch("/api/sessions"));
    setSessions(payload?.sessions ?? []);
    return payload?.sessions ?? [];
  }, [readJson]);

  const loadMetrics = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/metrics`);
      setMetrics(await readJson<Metrics>(res));
    },
    [readJson]
  );

  useEffect(() => {
    void (async () => {
      const list = await loadSessions();
      if (list.length > 0) setSelected((current) => current ?? list[0].id);
    })();
  }, [loadSessions]);

  // Loading history and metrics is what makes a session's Durable Object wake up.
  useEffect(() => {
    if (!selected) return;
    void (async () => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(selected)}/messages`);
      const payload = await readJson<{ messages: StoredMessage[] }>(res);
      if (!payload) return;
      setLoaded({ sessionId: selected, messages: payload.messages });
      await loadMetrics(selected);
    })();
  }, [selected, loadMetrics, readJson]);

  const createSession = async () => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: `Session ${sessions.length + 1}` }),
    });
    const row = await readJson<SessionRow>(res);
    if (!row) return;
    await loadSessions();
    setSelected(row.id);
  };

  const deleteSession = async (id: string) => {
    await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    const list = await loadSessions();
    if (selected === id) setSelected(list[0]?.id ?? null);
  };

  const onTurnEnd = useCallback(() => {
    if (selected) loadMetrics(selected);
    loadSessions();
  }, [selected, loadMetrics, loadSessions]);

  return (
    <div className="flex h-screen bg-zinc-900 text-zinc-100">
      <Sidebar
        sessions={sessions}
        selected={selected}
        onSelect={setSelected}
        onCreate={createSession}
        onDelete={deleteSession}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="border-b border-amber-900 bg-amber-950/60 px-6 py-3 text-xs text-amber-200">
            {error}
          </div>
        )}
        {selected ? (
          <>
            <CostHeader sessionId={selected} metrics={metrics} />
            {loaded?.sessionId !== selected ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
                Waking Durable Object…
              </div>
            ) : (
              <Chat
                key={selected}
                sessionId={selected}
                initialMessages={loaded.messages}
                onTurnEnd={onTurnEnd}
              />
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
            Create a session to start.
          </div>
        )}
      </main>
    </div>
  );
}
