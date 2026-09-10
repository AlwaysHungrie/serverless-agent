"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { Chat } from "@/components/Chat";
import { SessionHeader } from "@/components/SessionHeader";
import { Sidebar } from "@/components/Sidebar";
import { Welcome } from "@/components/Welcome";
import {
  MESSAGE_PAGE,
  SESSION_PAGE,
  telegramLink,
  type AgentRow,
  type SessionPage,
  type SessionRow,
  type StoredMessage,
  type Summary,
  type TranscriptPage,
} from "@/lib/agent";

/**
 * One agent: its sessions, its settings, its bot. Everything on this page is scoped
 * to the agent in the URL — there is no way to reach another agent's anything from
 * here, which is the point of the split.
 */
export default function AgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = use(params);
  const router = useRouter();
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  /**
   * Where the session list has been read up to: the cursor for the next page, and
   * whether there is one. Empty cursor with `more` false means the list is whole.
   */
  const [sessionCursor, setSessionCursor] = useState<{
    cursor: string;
    more: boolean;
  }>({ cursor: "", more: false });
  const [selected, setSelected] = useState<string | null>(null);
  // Keyed by session so switching sessions shows a loader instead of the previous
  // session's transcript, without having to null it out on every selection change.
  const [loaded, setLoaded] = useState<{
    sessionId: string;
    messages: StoredMessage[];
    /** Whether older messages remain unread behind the ones held here. */
    hasOlder: boolean;
    /** How many messages precede the oldest one held. A fork's count is absolute. */
    offset: number;
  } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The bot's handle, so a Telegram session can link back to the conversation — and
   * so the zero state can offer Telegram only once it actually works. Empty while
   * the capability is off or unconfigured.
   */
  const [botUsername, setBotUsername] = useState("");
  /** A forked question handed to one session's composer, waiting to be edited. */
  const [draft, setDraft] = useState<{
    sessionId: string;
    text: string;
  } | null>(null);
  /** Whether the sidebar drawer is showing. Only used below the md breakpoint. */
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  // Read once: the agent's name for the sidebar, and the bot handle for the links.
  useEffect(() => {
    void fetch(`/api/agents/${encodeURIComponent(agentId)}/config`)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          payload: {
            agent?: AgentRow;
            config?: { cap_telegram?: number; telegram_bot_username?: string };
          } | null,
        ) => {
          // No agent behind this id: it was deleted, or the link is stale.
          if (!payload) {
            router.replace("/");
            return;
          }
          setAgent(payload.agent ?? null);
          setBotUsername(
            payload.config?.cap_telegram
              ? (payload.config.telegram_bot_username ?? "")
              : "",
          );
        },
      )
      .catch(() => setBotUsername(""));
  }, [agentId, router]);

  /**
   * The newest page of sessions, replacing whatever was held.
   *
   * Called after anything that reorders the list — a new session, a rename, the end
   * of a turn — so it deliberately drops pages that were scrolled into: keeping them
   * across a reorder would show rows twice. The scroll starts again from the top,
   * which is where the list has just changed anyway.
   */
  const loadSessions = useCallback(async () => {
    const payload = await readJson<SessionPage>(
      await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/sessions?limit=${SESSION_PAGE}`,
      ),
    );
    setSessions(payload?.sessions ?? []);
    setSessionCursor({
      cursor: payload?.cursor ?? "",
      more: payload?.has_more ?? false,
    });
    return payload?.sessions ?? [];
  }, [readJson, agentId]);

  /** The page after the one the sidebar is showing, appended to it. */
  const loadMoreSessions = useCallback(async () => {
    if (!sessionCursor.more || !sessionCursor.cursor) return;
    const payload = await readJson<SessionPage>(
      await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/sessions?limit=${SESSION_PAGE}` +
          `&cursor=${encodeURIComponent(sessionCursor.cursor)}`,
      ),
    );
    if (!payload) return;
    // A session touched between the two reads can arrive on both pages; keying by id
    // keeps the first copy rather than drawing it twice.
    setSessions((current) => {
      const seen = new Set(current.map((s) => s.id));
      return [...current, ...payload.sessions.filter((s) => !seen.has(s.id))];
    });
    setSessionCursor({ cursor: payload.cursor, more: payload.has_more });
  }, [readJson, agentId, sessionCursor]);

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
        `/api/sessions/${encodeURIComponent(selected)}/messages?limit=${MESSAGE_PAGE}`,
      );
      const payload = await readJson<TranscriptPage>(res);
      if (!payload) return;
      setLoaded({
        sessionId: selected,
        messages: payload.messages,
        hasOlder: payload.has_more,
        offset: payload.offset,
      });
      await loadSummary(selected);
    })();
  }, [selected, loadSummary, readJson]);

  /**
   * The window of transcript before `beforeId`, handed to the chat to prepend. The
   * page owns the fetch so the chat does not have to know the route; the chat owns
   * where the messages land, because it is the one holding them.
   */
  const loadOlderMessages = useCallback(
    async (beforeId: string): Promise<TranscriptPage | null> => {
      if (!selected) return null;
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(selected)}/messages` +
          `?limit=${MESSAGE_PAGE}&before=${encodeURIComponent(beforeId)}`,
      );
      return await readJson<TranscriptPage>(res);
    },
    [selected, readJson],
  );

  const createSession = async () => {
    // No title: the session is called "New session" until the agent names it from
    // the first exchange.
    const res = await fetch(
      `/api/agents/${encodeURIComponent(agentId)}/sessions`,
      { method: "POST" },
    );
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

  /** Rename a session in place. The sidebar row follows from the reloaded list. */
  const renameSession = async (id: string, title: string) => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!(await readJson<{ ok: boolean }>(res))) return;
    await loadSessions();
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
    <div className="bg-canvas text-ink flex h-[100dvh]">
      <Sidebar
        agentId={agentId}
        agentName={agent?.name ?? ""}
        sessions={sessions}
        hasMore={sessionCursor.more}
        onLoadMore={loadMoreSessions}
        selected={selected}
        onSelect={setSelected}
        onCreate={createSession}
        onDelete={deleteSession}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onHome={() => setSelected(null)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="bg-canvas-soft text-ink border-hairline-soft border-b px-5 py-4 text-[14px] md:px-8 leading-[1.43]">
            {error}
          </div>
        )}
        {selected ? (
          <>
            <SessionHeader
              title={current?.title ?? "New session"}
              createdAt={current?.created_at ?? null}
              summary={summary}
              onRename={(title) => renameSession(selected, title)}
              onOpenSidebar={() => setSidebarOpen(true)}
            />
            {loaded?.sessionId !== selected ? (
              <div className="text-muted flex flex-1 items-center justify-center text-[20px] font-light mb-16">
                Connecting Session…
              </div>
            ) : (
              <Chat
                key={selected}
                sessionId={selected}
                initialMessages={loaded.messages}
                initialHasOlder={loaded.hasOlder}
                initialOffset={loaded.offset}
                onLoadOlder={loadOlderMessages}
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
          <>
            {/* With no session there is no header, so the drawer needs its own way open. */}
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sessions"
              className="text-ink hover:bg-canvas-soft m-3 flex h-9 w-9 items-center justify-center rounded-full transition md:hidden"
            >
              <Menu size={20} strokeWidth={1.75} />
            </button>
            <Welcome
              agentId={agentId}
              agentName={agent?.name ?? ""}
              onCreate={() => void createSession()}
              botUsername={botUsername}
            />
          </>
        )}
      </main>
    </div>
  );
}
