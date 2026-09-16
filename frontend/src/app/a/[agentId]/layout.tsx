"use client";

import { useState } from "react";
import { AuthModal } from "@/components/auth/AuthModal";
import { useIdentity } from "@/lib/identity";

/**
 * The front door, for the agent pages.
 *
 * Middleware used to turn a signed-out visitor away before these pages rendered. It no
 * longer does — it cannot see the localStorage back door, so protecting routes there
 * would bounce an impersonated visitor to a sign-in screen they have no use for. The
 * check moved here, where the browser is known.
 *
 * This is for the visitor, not for the data. Nothing on these pages is theirs to see
 * either way: every byte arrives from a route handler that forwards to the Worker, and
 * the Worker answers nobody it cannot identify and shows no agent to an address that is
 * not on its list. What this prevents is a blank frame full of failed requests where a
 * way in should be.
 */
export default function AgentLayout({ children }: LayoutProps<"/a/[agentId]">) {
  const { ready, signedIn } = useIdentity();
  const [authing, setAuthing] = useState(false);

  // Nothing is drawn until the identity has resolved: localStorage cannot be read on
  // the server, so the first paint knows nothing about who this is.
  if (!ready) {
    return (
      <div className="bg-canvas text-ink flex min-h-screen items-center justify-center">
        <p className="text-muted text-[14px] leading-[1.43]">Loading…</p>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="bg-canvas text-ink flex min-h-screen flex-col items-center justify-center gap-6 px-5">
        <p className="text-muted text-center text-[14px] font-light leading-[1.43]">
          Sign in to open this agent.
        </p>
        <button
          onClick={() => setAuthing(true)}
          className="bg-ink text-on-primary h-12 cursor-pointer rounded-full px-6 text-[16px] font-semibold transition hover:opacity-85"
        >
          Connect your Account
        </button>
        {authing && <AuthModal mode="sign-in" onClose={() => setAuthing(false)} />}
      </div>
    );
  }

  return <>{children}</>;
}
