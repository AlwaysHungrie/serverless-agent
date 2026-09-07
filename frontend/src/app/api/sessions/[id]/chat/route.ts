import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { agentUrl, type UsageData } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export type ChatUIMessage = UIMessage<never, { usage: UsageData }>;

/**
 * Bridges the Durable Object's SSE stream into the AI SDK UI message protocol, so
 * `useChat` gets streamed text plus a `data-usage` part carrying what the turn cost.
 *
 * The incoming request's abort signal is forwarded to the Worker. When the user hits
 * stop, the Worker's stream is cancelled, the Durable Object banks the partial reply
 * and the tokens already billed, and stops accruing duration.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { messages } = (await request.json()) as { messages: ChatUIMessage[] };

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text =
    lastUser?.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("") ?? "";

  const stream = createUIMessageStream<ChatUIMessage>({
    execute: async ({ writer }) => {
      const upstream = await fetch(agentUrl(id, "stream"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: request.signal,
      });

      if (!upstream.ok || !upstream.body) {
        throw new Error(`agent ${upstream.status}: ${await upstream.text()}`);
      }

      const textId = crypto.randomUUID();
      writer.write({ type: "text-start", id: textId });

      const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let closed = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;

          let cut: number;
          while ((cut = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            if (!frame.startsWith("data: ")) continue;

            const event = JSON.parse(frame.slice(6)) as
              | { type: "delta"; text: string }
              | ({ type: "usage" } & UsageData)
              | { type: "error"; error: string }
              | { type: "done" };

            if (event.type === "delta") {
              writer.write({ type: "text-delta", id: textId, delta: event.text });
            } else if (event.type === "usage") {
              writer.write({
                type: "data-usage",
                data: {
                  prompt_tokens: event.prompt_tokens,
                  completion_tokens: event.completion_tokens,
                  cost_usd: event.cost_usd,
                  llm_ms: event.llm_ms,
                  do_active_ms: event.do_active_ms,
                  rows_read: event.rows_read,
                  rows_written: event.rows_written,
                },
              });
            } else if (event.type === "error") {
              throw new Error(event.error);
            } else if (event.type === "done") {
              writer.write({ type: "text-end", id: textId });
              closed = true;
            }
          }
        }
      } finally {
        if (!closed) writer.write({ type: "text-end", id: textId });
      }
    },
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });

  return createUIMessageStreamResponse({ stream });
}
