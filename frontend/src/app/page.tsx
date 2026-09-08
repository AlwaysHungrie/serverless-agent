"use client";

import { useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { CostHeader } from "@/components/CostHeader";
import { Sidebar } from "@/components/Sidebar";
import type { ActualUsage, SessionRow, StoredMessage, Summary } from "@/lib/agent";

export default function Home() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Keyed by session so switching sessions shows a loader instead of the previous
  // session's transcript, without having to null it out on every selection change.
  const [loaded, setLoaded] = useState<{ sessionId: string; messages: StoredMessage[] } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actual, setActual] = useState<ActualUsage | null>(null);
  const [actualError, setActualError] = useState<string | null>(null);
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

  const loadSummary = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/summary`);
      setSummary(await readJson<Summary>(res));
    },
    [readJson]
  );

  /**
   * Cloudflare's analytics are the billing authority, but they lag, so this is a
   * separate on-demand fetch rather than something refreshed after every message.
   */
  const loadActualUsage = useCallback(async (id: string) => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/usage`);
    const payload = (await res.json().catch(() => null)) as (ActualUsage & { error?: string }) | null;
    if (!res.ok || !payload || payload.error) {
      setActual(null);
      setActualError(payload?.error ?? `Cloudflare usage unavailable (${res.status}).`);
      return;
    }
    setActual(payload);
    setActualError(null);
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
      const payload = await readJson<{ messages: StoredMessage[] }>(res);
      if (!payload) return;
      setLoaded({ sessionId: selected, messages: payload.messages });
      await loadSummary(selected);
      await loadActualUsage(selected);
    })();
  }, [selected, loadSummary, loadActualUsage, readJson]);

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
    if (selected) loadSummary(selected);
    loadSessions();
  }, [selected, loadSummary, loadSessions]);

  return (
    <div className="bg-canvas text-ink flex h-screen">
      <Sidebar
        sessions={sessions}
        selected={selected}
        onSelect={setSelected}
        onCreate={createSession}
        onDelete={deleteSession}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="bg-canvas-soft text-ink border-hairline-soft border-b px-8 py-4 text-[14px] leading-[1.43]">
            {error}
          </div>
        )}
        {selected ? (
          <>
            <CostHeader
              sessionId={selected}
              summary={summary}
              actual={actual}
              actualError={actualError}
              onRefreshUsage={() => loadActualUsage(selected)}
            />
            {loaded?.sessionId !== selected ? (
              <div className="text-muted flex flex-1 items-center justify-center text-[20px] font-light">
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
          <div className="text-muted flex flex-1 items-center justify-center text-[20px] font-light">
            Create a session to start.
          </div>
        )}
      </main>
    </div>
  );
}
