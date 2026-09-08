"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import type { ChatUIMessage } from "@/app/api/sessions/[id]/chat/route";
import type { StoredMessage, UsageData } from "@/lib/agent";
import { formatMs, formatUsd } from "@/lib/format";

function UsageLine({ usage }: { usage: UsageData }) {
  return (
    <div className="border-hairline-soft text-faint tnum mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-[12px] leading-[1.33]">
      <span>
        {usage.prompt_tokens} in / {usage.completion_tokens} out
      </span>
      <span className="text-ink font-semibold">{formatUsd(usage.cost_usd)}</span>
      <span>{formatMs(usage.llm_ms)} model</span>
    </div>
  );
}

function Bubble({ message }: { message: ChatUIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  const usage = message.parts.find((p) => p.type === "data-usage") as
    | { type: "data-usage"; data: UsageData }
    | undefined;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-2xl rounded-[24px] px-6 py-5 text-[16px] leading-[1.38] ${
          isUser
            ? "bg-ink text-on-primary"
            : "bg-canvas border-hairline-soft text-ink border"
        }`}
      >
        <div className="whitespace-pre-wrap">{text || (isUser ? "" : "…")}</div>
        {!isUser && usage && <UsageLine usage={usage.data} />}
      </div>
    </div>
  );
}

/** Turn the rows persisted in the Durable Object back into AI SDK messages. */
function toUIMessages(rows: StoredMessage[]): ChatUIMessage[] {
  return rows.map((row) => ({
    id: String(row.id),
    role: row.role,
    parts:
      row.role === "assistant"
        ? [
            { type: "text" as const, text: row.content },
            {
              type: "data-usage" as const,
              data: {
                prompt_tokens: row.prompt_tokens,
                completion_tokens: row.completion_tokens,
                cost_usd: row.cost_usd,
                llm_ms: row.ms,
              },
            },
          ]
        : [{ type: "text" as const, text: row.content }],
  }));
}

export function Chat({
  sessionId,
  initialMessages,
  onTurnEnd,
}: {
  sessionId: string;
  initialMessages: StoredMessage[];
  onTurnEnd: () => void;
}) {
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, stop, status, error } = useChat<ChatUIMessage>({
    id: sessionId,
    messages: toUIMessages(initialMessages),
    transport: new DefaultChatTransport({ api: `/api/sessions/${encodeURIComponent(sessionId)}/chat` }),
    onFinish: onTurnEnd,
  });

  const streaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    sendMessage({ text: input });
    setInput("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-8 py-10">
        {messages.length === 0 && (
          <p className="text-muted mx-auto max-w-md pt-20 text-center text-[20px] font-light leading-[1.38]">
            Send a message. The Durable Object wakes, streams a reply, and bills for the seconds it
            stays awake.
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {error && (
          <div className="bg-ink text-on-primary rounded-[24px] px-6 py-5 text-[16px] leading-[1.38]">
            {error.message}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="border-hairline-soft flex gap-3 border-t px-8 py-6">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message the agent…"
          className="bg-field placeholder:text-faint text-ink focus:ring-ink h-12 flex-1 rounded-[16px] px-4 text-[16px] outline-none focus:ring-2"
        />
        {streaming ? (
          <button
            type="button"
            onClick={() => {
              stop();
              onTurnEnd();
            }}
            className="border-hairline text-ink hover:bg-canvas-soft h-12 shrink-0 rounded-full border px-6 text-[16px] font-semibold transition"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="bg-ink text-on-primary h-12 shrink-0 rounded-full px-6 text-[16px] font-semibold transition hover:opacity-85 disabled:opacity-30"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
