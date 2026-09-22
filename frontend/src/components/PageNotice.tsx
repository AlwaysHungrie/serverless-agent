"use client";

import Link from "next/link";

/**
 * A whole page that is only a sentence and a way out.
 *
 * Used where a page cannot draw itself and the reason is not worth a screen of its
 * own: nobody is signed in, the agent behind this id is gone, the link was never good.
 * It says so and stops. Nothing here navigates on its own — leaving is the reader's
 * decision, and a page that redirects out from under someone reading it takes the
 * sentence away before it has been read.
 */
export function PageNotice({ message }: { message: string }) {
  return (
    <div className="bg-canvas text-ink flex min-h-screen flex-col items-center justify-center gap-6 px-5">
      <p className="text-muted text-center text-sm font-light leading-[1.43]">
        {message}
      </p>
      <Link
        href="/"
        className="bg-ink text-on-primary flex h-12 cursor-pointer items-center rounded-full px-6 text-base font-semibold transition hover:opacity-85"
      >
        Go back
      </Link>
    </div>
  );
}
