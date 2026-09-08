"use client";

import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/think/react";
import { useEffect, useState } from "react";

/**
 * The Think agent, as the browser sees it. Think owns the transcript, the agentic
 * loop and the streaming, so this page is a thin client over its websocket rather
 * than the REST-and-SSE surface the session agent exposes.
 */
const AGENT_HOST = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787";

export default function ThinkPage() {
  // The agent socket opens on connect, so the component stays out of the way until
  // it is running in a browser: prerendering it would dial the Worker at build time.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <ThinkChat /> : null;
}

function ThinkChat() {
  const agent = useAgent({
    agent: "ThinkAgent",
    name: "default",
    host: AGENT_HOST,
  });
  const { messages, sendMessage, status } = useAgentChat({ agent });
  const [input, setInput] = useState("");

  return (
    <main className="mx-auto flex h-dvh max-w-2xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-lg font-medium">Think</h1>
        <p className="text-sm text-neutral-500">
          The same settings and tools as a session, with the loop run by Think.
        </p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((message) => (
          <div key={message.id} className="text-sm">
            <span className="text-neutral-500">{message.role}: </span>
            {message.parts.map((part, i) =>
              part.type === "text" ? <span key={i}>{part.text}</span> : null
            )}
          </div>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = input.trim();
          if (!text) return;
          sendMessage({ text });
          setInput("");
        }}
      >
        <input
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
          placeholder="Send a message"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
          disabled={status === "streaming" || !input.trim()}
          type="submit"
        >
          Send
        </button>
      </form>
    </main>
  );
}
