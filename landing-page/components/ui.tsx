import type { ReactNode } from "react";

export function Wrap({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1120px] px-6 ${className}`}>
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">
      {children}
    </p>
  );
}

/** Stadium pill. Ink for the one action that matters, outline for the rest. */
export function Button({
  href,
  variant = "primary",
  size = "md",
  children,
}: {
  href: string;
  variant?: "primary" | "outline" | "invert";
  size?: "md" | "sm";
  children: ReactNode;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors";
  const sizes = { md: "h-12 px-6 text-base", sm: "h-10 px-4 text-sm" };
  const variants = {
    primary: "bg-ink text-white hover:bg-ink-soft",
    outline: "bg-canvas text-ink ring-1 ring-hairline hover:bg-canvas-soft",
    invert: "bg-white text-ink hover:bg-canvas-soft",
  };

  return (
    <a href={href} className={`${base} ${sizes[size]} ${variants[variant]}`}>
      {children}
    </a>
  );
}

/**
 * Every image on this page is a labelled slot, not a mocked-up screenshot.
 * `frame` adds browser chrome so product shots read as product shots.
 */
export function Placeholder({
  label,
  className = "",
  frame = false,
}: {
  label: string;
  className?: string;
  frame?: boolean;
}) {
  if (frame) {
    return (
      <div
        className={`overflow-hidden rounded-[24px] bg-canvas-soft ring-1 ring-hairline-soft ${className}`}
      >
        <div className="flex items-center gap-1.5 border-b border-hairline-soft bg-white/60 px-4 py-3">
          <span className="size-2.5 rounded-full bg-hairline" />
          <span className="size-2.5 rounded-full bg-hairline" />
          <span className="size-2.5 rounded-full bg-hairline" />
          <span className="ml-3 h-5 w-48 rounded-full bg-canvas-soft" />
        </div>
        <div className="flex min-h-[220px] items-center justify-center p-6 text-center text-sm text-faint">
          {label}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-center rounded-[16px] bg-canvas-soft p-6 text-center text-sm text-faint ring-1 ring-hairline-soft ${className}`}
    >
      {label}
    </div>
  );
}

/**
 * A destination that may not exist yet. Real href renders a link; `null`
 * renders plain text, so the page never ships a `#` that goes nowhere.
 * Unbuilt destinations are listed in BROKEN-LINKS.md.
 */
export function MaybeLink({
  href,
  className = "",
  children,
}: {
  href: string | null;
  className?: string;
  children: ReactNode;
}) {
  if (!href) {
    return (
      <span className={className} aria-disabled="true">
        {children}
      </span>
    );
  }

  const external = href.startsWith("http");

  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={className}
    >
      {children}
    </a>
  );
}
