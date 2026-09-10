"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import { formatDate } from "@/lib/format";
import type { AgentRow } from "@/lib/agent";

/**
 * Every agent in this deployment.
 *
 * Agents are separate all the way down — their own bot, their own OpenRouter key,
 * their own MCP servers, their own memory, their own sessions. So this page is a
 * list of doors and nothing more: there is no switcher, because there is nothing
 * shared to switch between. Opening one goes to its own page and stays there.
 */
export default function Agents() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The agent the delete dialog is asking about, if it is open. */
  const [confirming, setConfirming] = useState<AgentRow | null>(null);
  /** Whether the new-agent dialog is up. */
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/agents", { cache: "no-store" });
    const payload = (await res.json().catch(() => null)) as {
      agents?: AgentRow[];
      error?: string;
    } | null;
    if (!res.ok || !payload?.agents) {
      setError(payload?.error ?? "Couldn't load your agents. Refresh to try again.");
      setAgents([]);
      return;
    }
    setAgents(payload.agents);
    setError(null);
  }, []);

  // Only signed-in visitors have agents to load — and the route that lists them
  // answers nobody else. A signed-out visitor sees the front door instead.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void (async () => {
      await load();
    })();
  }, [load, isLoaded, isSignedIn]);

  /**
   * Make the agent, then open it. The name and the key are asked for up front, so a
   * new agent arrives able to answer — which is why this lands on its chats rather
   * than on its settings. A rejected key never gets this far: the Worker checks it
   * before it creates anything, and the dialog stays open with the reason.
   */
  const create = async (
    name: string,
    key: string,
    emails: string,
  ): Promise<string | null> => {
    setBusy(true);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        openrouter_api_key: key,
        allowed_emails: emails,
      }),
    });
    setBusy(false);
    const row = (await res.json().catch(() => null)) as
      | (AgentRow & { error?: string })
      | null;
    if (!res.ok || !row?.id) {
      return row?.error ?? "Couldn't create that agent. Try again.";
    }
    router.push(`/a/${encodeURIComponent(row.id)}`);
    return null;
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
    setBusy(false);
    await load();
  };

  return (
    <div className="bg-canvas text-ink min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-5 py-10 md:px-8 md:py-14">
        {/* Clerk Core 3 has no <SignedIn>/<SignedOut>; the session comes from the
            hook instead, and nothing is drawn until it has loaded — otherwise the
            prerendered page would flash the front door at someone already signed in. */}
        {!isLoaded && (
          <p className="text-muted py-16 text-[14px] leading-[1.43]">Loading…</p>
        )}

        {isLoaded && !isSignedIn && (
          <>
          <h1 className="text-[32px] font-[650] leading-[1.2]">Agents.</h1>
          <p className="text-muted mt-1 max-w-md text-[14px] font-light leading-[1.43]">
            Build an agent with its own bot, its own tools and its own memory.
            Sign in to make one, or to open an agent someone shared with you.
          </p>
          <div className="mt-8 flex gap-2">
            <SignUpButton mode="modal">
              <button className="bg-ink text-on-primary h-11 rounded-full px-5 text-[14px] font-semibold transition hover:opacity-85">
                Create an account
              </button>
            </SignUpButton>
            <SignInButton mode="modal">
              <button className="border-hairline text-ink hover:bg-canvas-soft h-11 rounded-full border px-5 text-[14px] font-semibold transition">
                Sign in
              </button>
            </SignInButton>
          </div>
          <p className="text-faint mt-6 max-w-md text-[12px] leading-[1.33]">
            An agent is only visible to the addresses it was shared with. Sign in
            with the address you were given and it appears in this list.
          </p>
          </>
        )}

        {isLoaded && isSignedIn && (
        <>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-[32px] font-[650] leading-[1.2]">Agents.</h1>
          <div className="flex shrink-0 items-center gap-3">
            {agents !== null && agents.length > 0 && (
              <button
                onClick={() => setCreating(true)}
                disabled={busy}
                className="bg-ink text-on-primary flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition hover:opacity-85 disabled:opacity-40"
              >
                <Plus size={16} strokeWidth={2} />
                New agent
              </button>
            )}
            <UserButton />
          </div>
        </div>
        <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
          Each one has its own bot, its own tools and its own memory. They share
          nothing.
        </p>

        {error && (
          <div className="bg-canvas-soft border-hairline-soft mt-8 rounded-[16px] border px-5 py-4 text-[14px] leading-[1.43]">
            {error}
          </div>
        )}

        {agents === null && (
          <p className="text-muted py-16 text-[14px] leading-[1.43]">
            Loading your agents…
          </p>
        )}

        {agents?.length === 0 && !error && (
          <div className="mt-12 max-w-md">
            <h2 className="text-[28px] font-[650] leading-[1.2]">
              Nothing here yet.
            </h2>
            <p className="text-muted mt-2 text-[16px] font-light leading-[1.5]">
              Make an agent, give it an OpenRouter key, and it can start
              answering — here, or on Telegram.
            </p>

            <button
              onClick={() => setCreating(true)}
              disabled={busy}
              className="bg-ink text-on-primary mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold transition hover:opacity-85 disabled:opacity-40"
            >
              <Plus size={18} strokeWidth={2} />
              New agent
            </button>

            <div className="border-hairline-soft mt-8 border-t pt-6">
              <p className="text-[14px] font-semibold leading-[1.43]">
                Shared with you?
              </p>
              <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
                An agent only appears here for the addresses it was shared with.
                Sign in with that address and it shows up in this list.
              </p>
            </div>
          </div>
        )}

        {agents && agents.length > 0 && (
          <div className="mt-8 space-y-2">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="hover:bg-canvas-soft group flex items-center gap-3 rounded-[16px] px-5 py-4 transition"
              >
                <Link
                  href={`/a/${encodeURIComponent(agent.id)}`}
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate text-[16px] font-semibold leading-[1.38]">
                    {agent.name}
                  </span>
                  <span className="text-faint block truncate text-[12px] leading-[1.33]">
                    Last used {formatDate(agent.updated_at)}
                  </span>
                </Link>
                <Link
                  href={`/a/${encodeURIComponent(agent.id)}/settings`}
                  className="text-muted hover:text-ink shrink-0 text-[14px] transition"
                >
                  Settings
                </Link>
                <button
                  onClick={() => setConfirming(agent)}
                  aria-label={`Delete ${agent.name}`}
                  className="text-muted hover:bg-canvas hover:text-ink flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[16px] leading-none opacity-100 transition md:opacity-0 md:group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        </>
        )}
      </div>

      {creating && (
        <NewAgent
          busy={busy}
          onCancel={() => setCreating(false)}
          onCreate={create}
        />
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="bg-canvas w-full max-w-sm rounded-[20px] px-6 py-6 shadow-xl">
            <p className="text-[16px] font-semibold leading-[1.38]">
              Delete {confirming.name}?
            </p>
            <p className="text-muted mt-2 text-[14px] font-light leading-[1.43]">
              Its chats, files, memories, settings and MCP connections all go
              with it, and its Telegram bot stops answering. This cannot be
              undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="border-hairline text-ink hover:bg-canvas-soft h-10 rounded-full border px-5 text-[14px] font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = confirming.id;
                  setConfirming(null);
                  void remove(id);
                }}
                className="bg-ink text-on-primary h-10 rounded-full px-5 text-[14px] font-semibold transition hover:opacity-85"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Name and key, asked for together.
 *
 * The key is here rather than left to Settings because it is what makes an agent able
 * to answer at all: asked for now, the agent works the moment it opens. It is still
 * optional — an agent without one falls back to the deployment's shared key, which is
 * fine for trying something out and wrong for anything that matters.
 */
function NewAgent({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  /** Resolves to an error to show in the dialog, or null once the agent opens. */
  onCreate: (name: string, key: string, emails: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  /** Extra addresses, free text. Your own is added by the Worker regardless. */
  const [emails, setEmails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  const submit = async () => {
    const cleaned = name.trim();
    if (!cleaned || busy) return;
    setError(await onCreate(cleaned, key.trim(), emails.trim()));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5"
      onClick={onCancel}
    >
      <div
        className="bg-canvas w-full max-w-sm rounded-[20px] px-6 py-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[16px] font-semibold leading-[1.38]">New agent</p>
        <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
          Its own bot, its own tools, its own memory.
        </p>

        <label className="mt-5 block">
          <span className="block text-[14px] font-semibold leading-[1.43]">
            Name
          </span>
          <input
            ref={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") onCancel();
            }}
            maxLength={60}
            placeholder="Research assistant"
            className="bg-field placeholder:text-faint mt-2 w-full rounded-[16px] px-4 py-3 text-[14px] outline-none"
          />
        </label>

        <label className="mt-4 block">
          <span className="block text-[14px] font-semibold leading-[1.43]">
            OpenRouter API key
          </span>
          <span className="text-muted block text-[12px] font-light leading-[1.33]">
            Every model call this agent makes is billed here. You can add it later
            in Settings.
          </span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") onCancel();
            }}
            placeholder="sk-or-v1-…"
            className="bg-field placeholder:text-faint mt-2 w-full rounded-[16px] px-4 py-3 text-[14px] outline-none"
          />
        </label>

        <label className="mt-4 block">
          <span className="block text-[14px] font-semibold leading-[1.43]">
            Who else can open it
          </span>
          <span className="text-muted block text-[12px] font-light leading-[1.33]">
            Email addresses, one per line or comma-separated. Everyone listed gets
            the whole agent — its chats, its settings and its keys. You are always
            on the list, and you can change it later in Settings.
          </span>
          <textarea
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
            }}
            rows={2}
            placeholder="teammate@example.com"
            className="bg-field placeholder:text-faint mt-2 w-full resize-y rounded-[16px] px-4 py-3 text-[14px] outline-none"
          />
        </label>

        {error && (
          <p className="mt-3 text-[12px] leading-[1.33]">{error}</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="border-hairline text-ink hover:bg-canvas-soft h-10 rounded-full border px-5 text-[14px] font-semibold transition"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || name.trim() === ""}
            className="bg-ink text-on-primary h-10 rounded-full px-5 text-[14px] font-semibold transition hover:opacity-85 disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
