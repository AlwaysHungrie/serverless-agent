"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import type { ChatUIMessage } from "@/app/api/sessions/[id]/chat/route";
import type { StoredMessage, UsageData } from "@/lib/agent";
import { formatMs, formatUsd } from "@/lib/format";

function UsageLine({ usage }: { usage: UsageData }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500">
      <span>
        {usage.prompt_tokens} in / {usage.completion_tokens} out
      </span>
      <span className="text-zinc-400">{formatUsd(usage.cost_usd)}</span>
      <span>{formatMs(usage.llm_ms)} model</span>
      {usage.do_active_ms != null && <span>{formatMs(usage.do_active_ms)} DO active</span>}
      {usage.rows_written != null && <span>{usage.rows_written} rows written</span>}
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
        className={`max-w-2xl rounded-lg px-4 py-3 text-sm leading-relaxed ${
          isUser ? "bg-blue-600 text-white" : "border border-zinc-800 bg-zinc-900 text-zinc-100"
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
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
        {messages.length === 0 && (
          <p className="pt-16 text-center text-sm text-zinc-600">
            Send a message. The Durable Object wakes, streams a reply, and bills for the seconds it
            stays awake.
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">
            {error.message}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t border-zinc-800 bg-zinc-950 px-6 py-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message the agent…"
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
        />
        {streaming ? (
          <button
            type="button"
            onClick={() => {
              stop();
              onTurnEnd();
            }}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:border-red-600 hover:text-red-400"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
