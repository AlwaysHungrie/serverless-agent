"use client";

import { useEffect, useRef, useState } from "react";
import { useIdentity } from "@/lib/identity";

/**
 * The back door's front door: a box that takes any address and becomes it.
 *
 * Shown in place of the Clerk card when this browser holds the deployment's
 * `API_SECRET` in localStorage. There is no code to check and no account to have —
 * whatever is typed here is who the Worker treats you as from the next call onward,
 * including addresses that have never signed up. That is the point of it.
 *
 * It says so plainly rather than dressing itself as sign-in. Someone who arrives at
 * this screen without knowing why should leave knowing exactly what is on.
 */
export function LocalSignIn() {
  const { signInAs } = useIdentity();
  const [email, setEmail] = useState("");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  const go = () => {
    const cleaned = email.trim();
    if (cleaned) signInAs(cleaned);
  };

  return (
    <div className="w-full max-w-sm">
      <h2 className="text-[32px] font-[650] leading-[1.13]">Be anyone.</h2>
      <p className="text-muted mt-2 text-[14px] font-light leading-[1.43]">
        This browser holds the deployment secret, so sign-in is off. Type an
        address and you are that person — no account, no code, no check.
      </p>

      <label className="mt-8 block">
        <span className="block text-[14px] font-semibold leading-[1.43]">
          Act as
        </span>
        <input
          ref={field}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
          placeholder="anyone@example.com"
          className="bg-field placeholder:text-faint focus:ring-ink mt-2 w-full rounded-[16px] px-4 py-3 text-[14px] outline-none focus:ring-2"
        />
      </label>

      <button
        type="button"
        onClick={go}
        disabled={!email.trim()}
        className="bg-ink text-on-primary mt-4 h-12 w-full cursor-pointer rounded-full text-[16px] font-semibold transition hover:opacity-85 disabled:opacity-40"
      >
        Continue
      </button>

      <p className="text-faint mt-6 text-[12px] leading-[1.33]">
        Remove <code className="font-semibold">API_SECRET</code> from this
        browser&rsquo;s localStorage to get normal sign-in back.
      </p>
    </div>
  );
}
