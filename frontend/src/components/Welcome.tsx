"use client";

import Link from "next/link";
import { MessageCircle, Send } from "lucide-react";

/**
 * The zero state: no session open. It is the first thing a new user sees and the
 * thing the sidebar logo comes back to, so it says what the agent is and gives the
 * two ways to reach it — here, or from Telegram once the bot is connected.
 */
export function Welcome({
  onCreate,
  /** The bot's handle, once Telegram is on and set up. Empty until then. */
  botUsername,
}: {
  onCreate: () => void;
  botUsername: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <h1 className="text-[28px] font-[650] leading-[1.2] md:text-[32px]">
          Hi. I&rsquo;m Baby.
        </h1>
        <p className="text-muted mt-2 text-[16px] font-light leading-[1.5]">
          Your agent in the cloud. Ask a question, hand me a file, or set
          something to run later. Every chat keeps its own memory.
        </p>

        <button
          onClick={onCreate}
          className="bg-ink text-on-primary mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold transition hover:opacity-85"
        >
          <MessageCircle size={18} strokeWidth={1.75} />
          Start a chat
        </button>

        <div className="border-hairline-soft mt-8 border-t pt-6">
          {botUsername ? (
            <>
              <p className="text-[14px] font-semibold leading-[1.43]">
                Or find me on Telegram
              </p>
              <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
                Message @{botUsername}, or add me to a group. Every chat shows up
                here too.
              </p>
              <a
                href={`https://t.me/${botUsername}`}
                target="_blank"
                rel="noreferrer"
                className="border-hairline text-ink hover:bg-canvas-soft mt-4 inline-flex h-11 items-center gap-2 rounded-full border px-5 text-[14px] font-semibold transition"
              >
                <Send size={16} strokeWidth={1.75} />
                Open Telegram
              </a>
            </>
          ) : (
            <>
              <p className="text-[14px] font-semibold leading-[1.43]">
                Prefer Telegram?
              </p>
              <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
                Connect your bot and you can chat with me from your phone, or from
                any group you add me to.
              </p>
              <Link
                href="/settings"
                className="border-hairline text-ink hover:bg-canvas-soft mt-4 inline-flex h-11 items-center gap-2 rounded-full border px-5 text-[14px] font-semibold transition"
              >
                <Send size={16} strokeWidth={1.75} />
                Connect Telegram
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
