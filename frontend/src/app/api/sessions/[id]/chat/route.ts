import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { agentUrl, type Attachment, type UsageData } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A tool the agent ran mid-turn, streamed so the UI can say what is happening. */
export type ToolData = { name: string; done: boolean; ok?: boolean };

/** The attachments sent with a user message, so the bubble can show them. */
export type FilesData = { attachments: Attachment[] };

/** When a message was written, for restored transcripts. Live ones are timed locally. */
export type MetaData = { ts: number };

export type ChatUIMessage = UIMessage<
  never,
  { usage: UsageData; tool: ToolData; files: FilesData; meta: MetaData }
>;

/**
 * Bridges the Durable Object's SSE stream into the AI SDK UI message protocol, so
 * `useChat` gets streamed text plus a `data-usage` part carrying what the turn cost.
 *
 * The incoming request's abort signal is forwarded to the Worker. When the user hits
 * stop, the Worker's stream is cancelled, the Durable Object banks the partial reply
 * and the tokens already billed, and stops accruing duration.
 */
/**
 * Stream failures reach the client as text, so they have to read as sentences. The
 * runtime's own wording does not: a cancelled or dropped connection surfaces from
 * undici as the bare word "terminated".
 */
function describeStreamError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/^terminated$/i.test(raw) || /aborted|ECONNRESET/i.test(raw)) {
    return "The reply was cut off before it finished. Send the message again to retry.";
  }
  const status = raw.match(/^agent (\d{3}): ([\s\S]*)$/);
  if (status) {
    const detail = (() => {
      try {
        return (JSON.parse(status[2]) as { error?: string }).error ?? status[2];
      } catch {
        return status[2];
      }
    })();
    return detail.trim() || `The agent returned ${status[1]}.`;
  }
  return raw || "Something went wrong on the way to the agent.";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { messages, trigger } = (await request.json()) as {
    messages: ChatUIMessage[];
    trigger?: "submit-message" | "regenerate-message";
  };
  // A retry re-asks the question already on record, so the agent rewinds to it
  // instead of banking a second copy — and the turn keeps its attachments.
  const retry = trigger === "regenerate-message";

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
        body: JSON.stringify({ message: text, retry }),
        signal: request.signal,
      });

      if (!upstream.ok || !upstream.body) {
        throw new Error(`agent ${upstream.status}: ${await upstream.text()}`);
      }

      // Text is emitted as one part per round, opened on the round's first token and
      // closed when the round ends in tool calls. Parts then reach the UI in the order
      // they happened — say something, run a tool, say something more — instead of all
      // the prose collapsing into one block above all the tool lines.
      let textId: string | null = null;
      let round = 0;
      const running = new Set<string>();
      const openText = () => {
        if (textId) return textId;
        textId = `${crypto.randomUUID()}-${round}`;
        writer.write({ type: "text-start", id: textId });
        return textId;
      };
      const closeText = () => {
        if (!textId) return;
        writer.write({ type: "text-end", id: textId });
        textId = null;
      };

      const reader = upstream.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
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
              | { type: "tool"; name: string }
              | { type: "tool_done"; name: string; ok: boolean }
              | { type: "error"; error: string }
              | { type: "done" };

            if (event.type === "delta") {
              writer.write({
                type: "text-delta",
                id: openText(),
                delta: event.text,
              });
            } else if (event.type === "usage") {
              writer.write({
                type: "data-usage",
                data: {
                  prompt_tokens: event.prompt_tokens,
                  completion_tokens: event.completion_tokens,
                  cost_usd: event.cost_usd,
                  llm_ms: event.llm_ms,
                },
              });
            } else if (event.type === "tool" || event.type === "tool_done") {
              // One part per tool call per round, re-sent as done: the UI keys on the
              // id and replaces the running line with a finished one.
              if (event.type === "tool") {
                closeText();
                running.add(event.name);
              }
              writer.write({
                type: "data-tool",
                id: `tool-${round}-${event.name}`,
                data: {
                  name: event.name,
                  done: event.type === "tool_done",
                  ...(event.type === "tool_done" ? { ok: event.ok } : {}),
                },
              });
              // The round is over once its last tool reports back; anything after this
              // belongs to the next one.
              if (event.type === "tool_done") {
                running.delete(event.name);
                if (running.size === 0) round++;
              }
            } else if (event.type === "error") {
              throw new Error(event.error);
            } else if (event.type === "done") {
              closeText();
              closed = true;
            }
          }
        }
      } finally {
        if (!closed) closeText();
      }
    },
    onError: (error) => describeStreamError(error),
  });

  return createUIMessageStreamResponse({ stream });
}
