"use client";

import { useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";

/**
 * The two values the WhatsApp guide asks the reader to paste into Meta's dashboard.
 *
 * Both are here rather than in the page because they need a browser: one copies to
 * the clipboard, the other invents a secret. The token is generated on a click
 * rather than on render, so the server and the browser never disagree about which
 * random bytes the field holds.
 */

function useCopy(value: string) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access denied: the value is on screen and can be selected.
    }
  };

  return { copied, copy };
}

const field =
  "bg-canvas-soft border-hairline mt-3 flex flex-col gap-2 rounded-xl border px-4 py-3";

const row = "flex items-center justify-end gap-2";

const value =
  "text-ink overflow-x-auto text-[13px] leading-[1.5] font-medium whitespace-pre-wrap";

const primary =
  "bg-ink text-on-primary flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition hover:opacity-85";

const secondary =
  "bg-canvas border-hairline text-ink flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 text-xs font-semibold transition hover:opacity-70";

export function CopyField({ value: text }: { value: string }) {
  const { copied, copy } = useCopy(text);

  return (
    <div className={field}>
      <code className={value}>{text}</code>
      <div className={row}>
        <button onClick={copy} className={primary} title="Copy">
          {copied ? (
            <Check size={14} strokeWidth={2} />
          ) : (
            <Copy size={14} strokeWidth={2} />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function VerifyTokenField() {
  const [token, setToken] = useState("");
  const { copied, copy } = useCopy(token);

  return (
    <div className={field}>
      <code className={`${value} ${token ? "" : "text-muted font-normal"}`}>
        {token || "No token yet"}
      </code>
      <div className={row}>
        <button
          onClick={() => setToken(randomToken())}
          className={token ? secondary : primary}
          title={token ? "Generate another" : "Generate a token"}
        >
          <RefreshCw size={14} strokeWidth={2} />
          {token ? "New" : "Generate"}
        </button>
        {token && (
          <button onClick={copy} className={primary} title="Copy">
            {copied ? (
              <Check size={14} strokeWidth={2} />
            ) : (
              <Copy size={14} strokeWidth={2} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}
