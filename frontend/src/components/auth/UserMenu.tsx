"use client";

import { useEffect, useRef, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";

/**
 * The signed-in avatar and its one menu item.
 *
 * Clerk's own <UserButton> carries a profile manager, an org switcher and its
 * branding; none of that has a place here. This is the picture and a way out.
 */
export function UserMenu() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // A dropdown that outlives a click elsewhere is a bug, not a feature.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isLoaded || !user) return null;

  // Google accounts arrive with a picture; email sign-ups get Clerk's generated
  // initials image, so there is always something to show.
  const label = user.primaryEmailAddress?.emailAddress ?? "Account";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="ring-hairline hover:ring-ink block h-12 w-12 cursor-pointer overflow-hidden rounded-full ring-2 transition"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={user.imageUrl}
          alt=""
          width={56}
          height={5}
          className="h-full w-full object-cover"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="bg-canvas border-hairline-soft absolute right-0 z-50 mt-2 w-44 rounded-[12px] border"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="hover:bg-canvas-soft w-full cursor-pointer rounded-[12px] px-3 py-2 text-left text-[14px] leading-[1.43] transition"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
