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

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    const { sessions } = (await res.json()) as { sessions: SessionRow[] };
    setSessions(sessions);
    return sessions;
  }, []);

  const loadMetrics = useCallback(async (id: string) => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/metrics`);
    setMetrics((await res.json()) as Metrics);
  }, []);

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
      const { messages } = (await res.json()) as { messages: StoredMessage[] };
      setLoaded({ sessionId: selected, messages });
      await loadMetrics(selected);
    })();
  }, [selected, loadMetrics]);

  const createSession = async () => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: `Session ${sessions.length + 1}` }),
    });
    const row = (await res.json()) as SessionRow;
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
