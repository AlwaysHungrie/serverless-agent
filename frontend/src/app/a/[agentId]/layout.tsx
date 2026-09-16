"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "@/lib/identity";

/**
 * Turn a signed-out visitor around before an agent page draws.
 *
 * Middleware used to do this. It no longer can: the second way to be somebody here is
 * the localStorage back door, which middleware cannot see — a page navigation carries
 * no headers of ours — so protecting routes there would bounce every impersonated
 * visitor to a sign-in screen they have no use for. The check moved here, where the
 * browser is known, and it does what the middleware did: sends them home.
 *
 * This is for the visitor, not for the data. Nothing on these pages is theirs to see
 * either way: every byte arrives from a route handler that forwards to the Worker, and
 * the Worker answers nobody it cannot identify and shows no agent to an address that is
 * not on its list. What this prevents is a blank frame full of failed requests where a
 * way in should be.
 */
export default function AgentLayout({ children }: LayoutProps<"/a/[agentId]">) {
  const { ready, signedIn } = useIdentity();
  const router = useRouter();

  useEffect(() => {
    // `replace`, not `push`: the page they could not open has no business sitting in
    // the history for the back button to return them to.
    if (ready && !signedIn) router.replace("/");
  }, [ready, signedIn, router]);

  // Nothing is drawn until the identity has resolved: localStorage cannot be read on
  // the server, so the first paint knows nothing about who this is.
  if (!ready) {
    return (
      <div className="bg-canvas text-ink flex min-h-screen items-center justify-center">
        <p className="text-muted text-[14px] leading-[1.43]">Loading…</p>
      </div>
    );
  }

  // What shows while the redirect above is on its way, and the whole answer if it never
  // lands. The button is the same destination, reachable by hand.
  if (!signedIn) {
    return (
      <div className="bg-canvas text-ink flex min-h-screen flex-col items-center justify-center gap-6 px-5">
        <p className="text-muted text-center text-[14px] font-light leading-[1.43]">
          You need to be signed in to access this page.
        </p>
        <button
          onClick={() => router.replace("/")}
          className="bg-ink text-on-primary h-12 cursor-pointer rounded-full px-6 text-[16px] font-semibold transition hover:opacity-85"
        >
          Go back
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
