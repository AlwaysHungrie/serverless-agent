"use client";

import { useEffect } from "react";
import { AuthCard, type AuthMode } from "./AuthCard";
import { LocalSignIn } from "./LocalSignIn";
import { useIdentity } from "@/lib/identity";

/**
 * The auth card in a dialog, for signing in without leaving the page.
 *
 * Same chrome as the other dialogs on the front page: a scrim, a `{rounded.md}`
 * canvas panel, escape and backdrop-click both close it.
 *
 * A browser holding the deployment secret gets the address box instead of the Clerk
 * card. The dialog is the same dialog — only what it is asking for changes.
 */
export function AuthModal({
  mode,
  redirectUrl,
  onClose,
}: {
  mode: AuthMode;
  redirectUrl?: string;
  onClose: () => void;
}) {
  const { mode: identityMode } = useIdentity();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5"
      onClick={onClose}
    >
      <div
        className="bg-canvas w-full max-w-sm rounded-[24px] px-6 py-8"
        onClick={(e) => e.stopPropagation()}
      >
        {identityMode === "local" ? (
          <LocalSignIn />
        ) : (
          <AuthCard mode={mode} redirectUrl={redirectUrl} onDone={onClose} />
        )}
      </div>
    </div>
  );
}
