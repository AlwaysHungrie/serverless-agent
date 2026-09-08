"use client";

import { useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { SessionHeader } from "@/components/SessionHeader";
import { Sidebar } from "@/components/Sidebar";
import {
  telegramLink,
  type SessionRow,
  type StoredMessage,
  type Summary,
} from "@/lib/agent";

export default function Home() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Keyed by session so switching sessions shows a loader instead of the previous
  // session's transcript, without having to null it out on every selection change.
  const [loaded, setLoaded] = useState<{
    sessionId: string;
    messages: StoredMessage[];
  } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The bot's handle, so a Telegram session can link back to the conversation. */
  const [botUsername, setBotUsername] = useState("");
  /** A forked question handed to one session's composer, waiting to be edited. */
  const [draft, setDraft] = useState<{
    sessionId: string;
    text: string;
  } | null>(null);

  /** Reads a proxy response, surfacing the Worker-unreachable message as an error. */
  const readJson = useCallback(async <T,>(res: Response): Promise<T | null> => {
    const payload = (await res.json().catch(() => null)) as
      | (T & { error?: string })
      | null;
    if (!res.ok || !payload) {
      setError(payload?.error ?? `Request failed with ${res.status}.`);
      return null;
    }
    setError(null);
    return payload;
  }, []);

  // Read once: the link is the only thing this page needs out of the settings.
  useEffect(() => {
    void fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { config?: { telegram_bot_username?: string } } | null) =>
        setBotUsername(payload?.config?.telegram_bot_username ?? ""),
      )
      .catch(() => setBotUsername(""));
  }, []);

  const loadSessions = useCallback(async () => {
    const payload = await readJson<{ sessions: SessionRow[] }>(
      await fetch("/api/sessions"),
    );
    setSessions(payload?.sessions ?? []);
    return payload?.sessions ?? [];
  }, [readJson]);

  const loadSummary = useCallback(
    async (id: string) => {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(id)}/summary`,
      );
      setSummary(await readJson<Summary>(res));
    },
    [readJson],
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
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(selected)}/messages`,
      );
      const payload = await readJson<{ messages: StoredMessage[] }>(res);
      if (!payload) return;
      setLoaded({ sessionId: selected, messages: payload.messages });
      await loadSummary(selected);
    })();
  }, [selected, loadSummary, readJson]);

  const createSession = async () => {
    // No title: the session is called "New session" until the agent names it from
    // the first exchange.
    const res = await fetch("/api/sessions", { method: "POST" });
    const row = await readJson<SessionRow>(res);
    if (!row) return;
    await loadSessions();
    setSelected(row.id);
  };

  /**
   * Branch a conversation: the first `count` messages are copied into a fresh
   * session, which then opens. The original is left exactly as it was.
   */
  const forkSession = async (id: string, count: number, draft: string) => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count }),
    });
    const row = await readJson<SessionRow>(res);
    if (!row) return;
    await loadSessions();
    // The question the fork dropped waits in the new session's composer.
    setDraft(draft ? { sessionId: row.id, text: draft } : null);
    setSelected(row.id);
  };

  const deleteSession = async (id: string) => {
    await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const list = await loadSessions();
    if (selected === id) setSelected(list[0]?.id ?? null);
  };

  const onTurnEnd = useCallback(() => {
    if (selected) loadSummary(selected);
    loadSessions();
  }, [selected, loadSummary, loadSessions]);

  const current = sessions.find((s) => s.id === selected) ?? null;

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
            <SessionHeader
              title={current?.title ?? "New session"}
              createdAt={current?.created_at ?? null}
              summary={summary}
            />
            {loaded?.sessionId !== selected ? (
              <div className="text-muted flex flex-1 items-center justify-center text-[20px] font-light">
                Connecting Session…
              </div>
            ) : (
              <Chat
                key={selected}
                sessionId={selected}
                initialMessages={loaded.messages}
                onTurnEnd={onTurnEnd}
                initialInput={draft?.sessionId === selected ? draft.text : ""}
                onFork={(count, text) =>
                  void forkSession(selected, count, text)
                }
                // A Telegram chat is read here and answered there: the composer would
                // send into a conversation the other people in it cannot see.
                continueAt={
                  current?.source === "telegram"
                    ? {
                        label: "Telegram",
                        href: telegramLink(current, botUsername),
                      }
                    : null
                }
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
