"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { AuthModal } from "@/components/auth/AuthModal";
import { UserMenu } from "@/components/auth/UserMenu";
import {
  MetaSettingsDialog,
  MetaSettingsForm,
} from "@/components/MetaSettings";
import { formatDate } from "@/lib/format";
import {
  EMPTY_META,
  type AgentRow,
  type Capability,
  type MetaSettings,
  type ModelOption,
} from "@/lib/agent";

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
  /** The agent whose meta settings — the defaults behind its settings — are open. */
  const [metaFor, setMetaFor] = useState<AgentRow | null>(null);
  /** Whether the sign-in dialog is up. */
  const [authing, setAuthing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/agents", { cache: "no-store" });
    const payload = (await res.json().catch(() => null)) as {
      agents?: AgentRow[];
      error?: string;
    } | null;
    if (!res.ok || !payload?.agents) {
      setError(
        payload?.error ?? "Couldn't load your agents. Refresh to try again.",
      );
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
    meta: MetaSettings,
  ): Promise<string | null> => {
    setBusy(true);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        openrouter_api_key: key,
        allowed_emails: emails,
        // The second step. Creation is the only time the default model and the
        // default MCP servers can be chosen, so they travel with this call.
        meta,
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
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[32px] font-[650] leading-[1.2]">
              Cloud Agents.
            </h1>
            <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
              Personal, Always Accessible AI Agents
            </p>
          </div>
          {isLoaded && isSignedIn && (
            <div className="flex shrink-0 items-center gap-3">
              <UserMenu />
            </div>
          )}
        </div>

        {/* Clerk Core 3 has no <SignedIn>/<SignedOut>; the session comes from the
            hook instead, and nothing is drawn until it has loaded — otherwise the
            prerendered page would flash the front door at someone already signed in. */}
        {!isLoaded && (
          <p className="text-muted py-16 text-[14px] leading-[1.43]">
            Loading…
          </p>
        )}

        {isLoaded && !isSignedIn && (
          <div className="mt-8 space-y-2 w-full">
            <button
              onClick={() => setAuthing(true)}
              className="w-full min-h-17 bg-canvas-soft hover:bg-canvas-soft/60 group flex cursor-pointer items-center gap-3 rounded-[16px] px-5 py-4 transition"
            >
              <Plus size={18} strokeWidth={2} />
              Connect your Account
            </button>
            <p className="text-faint mt-6 text-[12px] leading-[1.33]">
              You can find safety guidelines and best practices for running a
              public facing agent in the{" "}
              <a href="/docs" className="text-primary font-semibold underline">
                docs
              </a>
              .
              <br />
              By signing up you agree to our{" "}
              <a href="/tos" className="text-primary hover:underline">
                terms of service
              </a>{" "}
              and{" "}
              <a href="/privacy" className="text-primary hover:underline">
                privacy policy
              </a>
              .
              <br />
            </p>
          </div>
        )}

        {isLoaded && isSignedIn && (
          <>
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

            {/* The create tile lives inside this block, not under a non-empty
                list: an account with no agents is exactly the one that needs it. */}
            {agents && (
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
                    {/* Admin settings are the defaults behind the agent's own
                        settings, so they are reachable only from here — never from
                        the agent's pages, where they would read as one more setting. */}
                    <button
                      onClick={() => setMetaFor(agent)}
                      className="text-muted hover:text-ink shrink-0 text-[14px] transition"
                    >
                      Admin Settings
                    </button>
                    <Link
                      href={`/a/${encodeURIComponent(agent.id)}/settings`}
                      title={`Settings for ${agent.name}`}
                      aria-label={`Settings for ${agent.name}`}
                      className="text-muted hover:bg-canvas hover:text-ink flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition"
                    >
                      <SlidersHorizontal size={15} strokeWidth={1.75} />
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

                <div
                  onClick={() => setCreating(true)}
                  className="min-h-17 bg-canvas-soft hover:bg-canvas-soft/60 group flex cursor-pointer items-center gap-3 rounded-[16px] px-5 py-4 transition"
                >
                  <Plus size={18} strokeWidth={2} />
                  Create a new Agent
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {authing && (
        <AuthModal mode="sign-in" onClose={() => setAuthing(false)} />
      )}

      {metaFor && (
        <MetaSettingsDialog agent={metaFor} onClose={() => setMetaFor(null)} />
      )}

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
 * Who the agent is, then what it is: name and key first, its defaults second.
 *
 * The key is asked for here rather than left to Settings because it is what makes an
 * agent able to answer at all. The second step is meta settings, and it is a step
 * rather than something to come back to: the default model and the default MCP
 * servers can only be chosen while the agent is being made — a model default applied
 * later would move an agent that has already answered on one, and a default server
 * added later would collide by name with one that may be connected.
 */
function NewAgent({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  /** Resolves to an error to show in the dialog, or null once the agent opens. */
  onCreate: (
    name: string,
    key: string,
    emails: string,
    meta: MetaSettings,
  ) => Promise<string | null>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  /** Extra addresses, free text. Your own is added by the Worker regardless. */
  const [emails, setEmails] = useState("");
  const [meta, setMeta] = useState<MetaSettings>(EMPTY_META);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  // The catalogues the second step picks from. There is no agent to hang them off
  // yet, so they come from the deployment rather than from one agent's config.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/agents/catalog", { cache: "no-store" });
      const payload = (await res.json().catch(() => null)) as {
        models?: ModelOption[];
        capabilities?: Capability[];
      } | null;
      setModels(payload?.models ?? []);
      setCapabilities(payload?.capabilities ?? []);
    })();
  }, []);

  const submit = async () => {
    const cleaned = name.trim();
    if (!cleaned || busy) return;
    setError(await onCreate(cleaned, key.trim(), emails.trim(), meta));
  };

  if (step === 2) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-5 py-10"
        onClick={onCancel}
      >
        <div
          className="bg-canvas text-ink w-full max-w-lg rounded-[20px] px-6 py-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-faint text-[12px] leading-[1.33]">Step 2 of 2</p>
          <p className="text-[18px] font-semibold leading-[1.38]">
            Meta settings
          </p>
          <p className="text-muted mt-1 text-[12px] font-light leading-[1.33]">
            Set the defaults for {name.trim() || "this agent"}, and choose what
            its owner can change. A locked setting will not be shown to the
            owner for configuration.
          </p>

          <div className="mt-4">
            <MetaSettingsForm
              meta={meta}
              onChange={setMeta}
              models={models}
              capabilities={capabilities}
              creation
            />
          </div>

          {error && <p className="mt-3 text-[12px] leading-[1.33]">{error}</p>}

          <div className="border-hairline-soft mt-2 flex justify-end gap-2 border-t pt-5">
            <button
              onClick={() => setStep(1)}
              className="border-hairline text-ink hover:bg-canvas-soft h-10 rounded-full border px-5 text-[14px] font-semibold transition"
            >
              Back
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy}
              className="bg-ink text-on-primary h-10 rounded-full px-5 text-[14px] font-semibold transition hover:opacity-85 disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5"
      onClick={onCancel}
    >
      <div
        className="bg-canvas w-full max-w-sm rounded-[20px] px-6 py-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-faint text-[12px] leading-[1.33]">Step 1 of 2</p>
        <p className="text-[18px] font-semibold leading-[1.38]">
          Create a new agent
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
              if (e.key === "Enter" && name.trim()) setStep(2);
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
            Optional, gets your agent running from the get-go. You can always
            add it later in Settings.
          </span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) setStep(2);
              if (e.key === "Escape") onCancel();
            }}
            placeholder="sk-or-v1-…"
            className="bg-field placeholder:text-faint mt-2 w-full rounded-[16px] px-4 py-3 text-[14px] outline-none"
          />
        </label>

        <label className="mt-4 block">
          <span className="block text-[14px] font-semibold leading-[1.43]">
            Who can access this agent
          </span>
          <span className="text-muted block text-[12px] font-light leading-[1.33]">
            Comma-separated emails. These people can message your agent, manage
            it, and read its chats on your behalf. Leave empty if unsure, after
            creation you can connect Telegram to let others message it.
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

        {error && <p className="mt-3 text-[12px] leading-[1.33]">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="border-hairline text-ink hover:bg-canvas-soft h-10 rounded-full border px-5 text-[14px] font-semibold transition"
          >
            Cancel
          </button>
          <button
            onClick={() => setStep(2)}
            disabled={busy || name.trim() === ""}
            className="bg-ink text-on-primary h-10 rounded-full px-5 text-[14px] font-semibold transition hover:opacity-85 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
