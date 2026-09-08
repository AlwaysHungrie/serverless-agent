"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatUIMessage, FilesData, ToolData } from "@/app/api/sessions/[id]/chat/route";
import {
  capabilityReady,
  type Attachment,
  type Capability,
  type Config,
  type StoredMessage,
  type UsageData,
} from "@/lib/agent";
import { formatMs, formatUsd } from "@/lib/format";

/** How a tool call reads while it runs, and once it is done. */
const TOOL_LABELS: Record<string, [running: string, done: string]> = {
  web_search: ["Searching the web…", "Searched the web"],
  fetch_url: ["Reading the page…", "Read the page"],
  generate_image: ["Drawing…", "Drew an image"],
  schedule_task: ["Scheduling…", "Scheduled a task"],
  list_scheduled_tasks: ["Checking the schedule…", "Checked the schedule"],
  cancel_scheduled_task: ["Cancelling…", "Cancelled a task"],
  remember: ["Remembering…", "Remembered"],
  recall: ["Recalling…", "Recalled"],
};

function toolLabel(tool: ToolData) {
  const pair = TOOL_LABELS[tool.name] ?? [`Running ${tool.name}…`, `Ran ${tool.name}`];
  return tool.done ? pair[1] : pair[0];
}

function UsageLine({ usage }: { usage: UsageData }) {
  return (
    <div className="border-hairline-soft text-faint tnum mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-[12px] leading-[1.33]">
      <span>
        {usage.prompt_tokens} + {usage.completion_tokens} tkns
      </span>
      <span className="text-ink font-semibold">{formatUsd(usage.cost_usd)}</span>
      <span>{formatMs(usage.llm_ms)}</span>
    </div>
  );
}

/** Where the browser reads an attachment's bytes from. */
function fileUrl(sessionId: string, id: string) {
  return `/api/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(id)}`;
}

/**
 * Markdown, rendered with an explicit component map rather than a prose plugin, so
 * every element lands on the same monochrome scale as the rest of the app.
 */
const MARKDOWN_COMPONENTS = (sessionId: string) => ({
  p: (props: React.ComponentProps<"p">) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: (props: React.ComponentProps<"ul">) => (
    <ul className="my-2 list-disc space-y-1 pl-5" {...props} />
  ),
  ol: (props: React.ComponentProps<"ol">) => (
    <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />
  ),
  li: (props: React.ComponentProps<"li">) => <li className="leading-[1.5]" {...props} />,
  h1: (props: React.ComponentProps<"h1">) => <h1 className="mt-4 mb-2 text-[20px]" {...props} />,
  h2: (props: React.ComponentProps<"h2">) => <h2 className="mt-4 mb-2 text-[18px]" {...props} />,
  h3: (props: React.ComponentProps<"h3">) => <h3 className="mt-3 mb-1 text-[16px]" {...props} />,
  a: (props: React.ComponentProps<"a">) => (
    <a className="underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />
  ),
  strong: (props: React.ComponentProps<"strong">) => <strong className="font-semibold" {...props} />,
  hr: () => <hr className="border-hairline-soft my-4" />,
  blockquote: (props: React.ComponentProps<"blockquote">) => (
    <blockquote className="border-hairline my-2 border-l-2 pl-4 italic" {...props} />
  ),
  code: ({ className, ...props }: React.ComponentProps<"code">) =>
    // Fenced code arrives wrapped in <pre>, which carries the block styling; only
    // inline code needs its own chip.
    className?.includes("language-") ? (
      <code className={className} {...props} />
    ) : (
      <code className="bg-canvas-soft rounded px-1.5 py-0.5 text-[14px]" {...props} />
    ),
  pre: (props: React.ComponentProps<"pre">) => (
    <pre
      className="bg-canvas-soft my-2 overflow-x-auto rounded-[16px] px-4 py-3 text-[13px] leading-[1.5]"
      {...props}
    />
  ),
  table: (props: React.ComponentProps<"table">) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[14px]" {...props} />
    </div>
  ),
  th: (props: React.ComponentProps<"th">) => (
    <th className="border-hairline-soft border-b px-3 py-2 text-left font-semibold" {...props} />
  ),
  td: (props: React.ComponentProps<"td">) => (
    <td className="border-hairline-soft border-b px-3 py-2 align-top" {...props} />
  ),
  img: ({ src, alt }: React.ComponentProps<"img">) => (
    // The Worker names its own path for a generated image; the browser reaches it
    // through the API route.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={String(src ?? "").replace(
        /^\/agents\/session-agent\/[^/]+\/files\//,
        `/api/sessions/${encodeURIComponent(sessionId)}/files/`,
      )}
      alt={alt ?? ""}
      className="border-hairline-soft my-2 block max-w-full rounded-[16px] border"
    />
  ),
});

/** Attachments as they appear on a sent message: images as thumbnails, files as chips. */
function AttachmentStrip({
  attachments,
  sessionId,
  onRemove,
}: {
  attachments: Attachment[];
  sessionId: string;
  onRemove?: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {attachments.map((a) =>
        a.kind === "image" ? (
          <span key={a.id} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fileUrl(sessionId, a.id)}
              alt={a.name}
              className="border-hairline-soft h-16 w-16 rounded-[12px] border object-cover"
            />
            {onRemove && (
              <button
                onClick={() => onRemove(a.id)}
                aria-label={`Remove ${a.name}`}
                className="bg-ink text-on-primary absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full"
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            )}
          </span>
        ) : (
          <span
            key={a.id}
            className="bg-field text-ink flex items-center gap-2 rounded-full py-1.5 pr-2 pl-3 text-[12px] leading-[1.33]"
          >
            <FileText size={13} strokeWidth={1.75} className="shrink-0" />
            <span className="max-w-[200px] truncate">{a.name}</span>
            <span className="text-faint tnum">{a.chars} chars</span>
            {onRemove && (
              <button
                onClick={() => onRemove(a.id)}
                aria-label={`Remove ${a.name}`}
                className="text-muted hover:text-ink flex h-5 w-5 items-center justify-center rounded-full"
              >
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </span>
        ),
      )}
    </div>
  );
}

function Bubble({ message, sessionId }: { message: ChatUIMessage; sessionId: string }) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  const usage = message.parts.find((p) => p.type === "data-usage") as
    | { type: "data-usage"; data: UsageData }
    | undefined;
  const tools = message.parts.filter(
    (p): p is { type: "data-tool"; id?: string; data: ToolData } => p.type === "data-tool",
  );
  const files = message.parts.find((p) => p.type === "data-files") as
    | { type: "data-files"; data: FilesData }
    | undefined;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-2xl rounded-[24px] px-6 py-5 text-[16px] leading-[1.38] ${
          isUser ? "bg-ink text-on-primary" : "bg-canvas border-hairline-soft text-ink border"
        }`}
      >
        {files && files.data.attachments.length > 0 && (
          <div className="mb-3">
            <AttachmentStrip attachments={files.data.attachments} sessionId={sessionId} />
          </div>
        )}

        {tools.length > 0 && (
          <div className="text-faint mb-3 space-y-1 text-[12px] leading-[1.33]">
            {tools.map((t, i) => (
              <div key={t.id ?? i}>{toolLabel(t.data)}</div>
            ))}
          </div>
        )}

        {isUser ? (
          <div className="whitespace-pre-wrap">{text}</div>
        ) : text ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS(sessionId)}>
            {text}
          </ReactMarkdown>
        ) : (
          "…"
        )}

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
        : [
            ...(row.attachments?.length
              ? [{ type: "data-files" as const, data: { attachments: row.attachments } }]
              : []),
            { type: "text" as const, text: row.content },
          ],
  }));
}

/** The file types the attach button offers, given which input capabilities are on. */
function acceptFor(ready: Set<string>): string {
  const accept: string[] = [];
  if (ready.has("file_ingest")) accept.push("text/*", ".md", ".csv", ".json", ".yaml", ".ts", ".tsx", ".py");
  if (ready.has("vision")) accept.push("image/*");
  if (ready.has("audio_input")) accept.push("audio/*");
  return accept.join(",");
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  // Local previews shown while a file is still on its way to the Worker.
  const [ghosts, setGhosts] = useState<{ key: string; name: string; preview: string | null }[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ready, setReady] = useState<Set<string>>(new Set());
  const bottom = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Which input capabilities are usable decides what may be attached at all.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/config");
      const payload = (await res.json().catch(() => null)) as
        | { config: Config; capabilities: Capability[] }
        | null;
      if (!payload?.config) return;
      setReady(
        new Set(
          payload.capabilities
            .filter((c) => capabilityReady(c, payload.config))
            .map((c) => c.id),
        ),
      );
    })();
  }, []);

  // An upload that was never sent stays pending in the Durable Object, so the chips
  // are restored when the session is reopened.
  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files`);
      const payload = (await res.json().catch(() => null)) as { attachments?: Attachment[] } | null;
      setAttachments(payload?.attachments ?? []);
    })();
  }, [sessionId]);

  const { messages, sendMessage, stop, status, error } = useChat<ChatUIMessage>({
    id: sessionId,
    messages: toUIMessages(initialMessages),
    transport: new DefaultChatTransport({
      api: `/api/sessions/${encodeURIComponent(sessionId)}/chat`,
    }),
    onFinish: onTurnEnd,
  });

  const streaming = status === "streaming" || status === "submitted";
  const canAttach = ready.has("file_ingest") || ready.has("vision") || ready.has("audio_input");

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const upload = async (files: FileList) => {
    setUploading(true);
    setUploadError(null);
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}`;
      // An image can be previewed from the browser's own copy straight away, so the
      // thumbnail appears on pick rather than after the round trip.
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setGhosts((g) => [...g, { key, name: file.name, preview }]);

      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files`, {
        method: "POST",
        body: form,
      });
      const payload = (await res.json().catch(() => null)) as
        | { attachment?: Attachment; error?: string }
        | null;

      setGhosts((g) => g.filter((x) => x.key !== key));
      if (preview) URL.revokeObjectURL(preview);

      if (!res.ok || !payload?.attachment) {
        setUploadError(payload?.error ?? `Could not upload ${file.name}.`);
        continue;
      }
      setAttachments((a) => [...a, payload.attachment!]);
    }
    setUploading(false);
  };

  const remove = async (id: string) => {
    setAttachments((a) => a.filter((x) => x.id !== id));
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files/${id}`, { method: "DELETE" });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (streaming) return;
    // An attachment on its own is a valid turn: "here is the file" needs no words.
    if (!input.trim() && attachments.length === 0) return;
    // The attachments ride along as a data part purely so the sent bubble can draw
    // them at once; the Worker already has them, and takes them from its own table.
    sendMessage({
      role: "user",
      parts: [
        ...(attachments.length ? [{ type: "data-files" as const, data: { attachments } }] : []),
        { type: "text" as const, text: input },
      ],
    });
    setInput("");
    // The Worker marks them used as the turn starts; the chips go with them.
    setAttachments([]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-8 py-10">
        {messages.length === 0 && (
          <p className="text-muted mx-auto max-w-md pt-20 text-center text-[20px] font-light leading-[1.38]">
            Send a message. The Durable Object wakes, streams a reply, and bills for the
            seconds it stays awake.
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} sessionId={sessionId} />
        ))}
        {error && (
          <div className="bg-ink text-on-primary rounded-[24px] px-6 py-5 text-[16px] leading-[1.38]">
            {error.message}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="border-hairline-soft border-t px-8 py-6">
        {(attachments.length > 0 || ghosts.length > 0 || uploadError) && (
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <AttachmentStrip
                attachments={attachments}
                sessionId={sessionId}
                onRemove={(id) => void remove(id)}
              />
              {ghosts.map((g) =>
                g.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={g.key}
                    src={g.preview}
                    alt={g.name}
                    className="border-hairline-soft h-16 w-16 animate-pulse rounded-[12px] border object-cover"
                  />
                ) : (
                  <span
                    key={g.key}
                    className="bg-field text-muted flex animate-pulse items-center gap-2 rounded-full py-1.5 pr-3 pl-3 text-[12px] leading-[1.33]"
                  >
                    <FileText size={13} strokeWidth={1.75} />
                    <span className="max-w-[200px] truncate">{g.name}</span>
                  </span>
                ),
              )}
            </div>
            {uploadError && <p className="text-muted text-[12px]">{uploadError}</p>}
          </div>
        )}

        <form onSubmit={submit} className="flex gap-3">
          {canAttach && (
            <>
              <input
                ref={picker}
                type="file"
                multiple
                accept={acceptFor(ready)}
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) void upload(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => picker.current?.click()}
                disabled={uploading}
                title="Attach a file"
                aria-label="Attach a file"
                className="border-hairline text-ink hover:bg-canvas-soft flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-40"
              >
                <Paperclip size={18} strokeWidth={1.75} />
              </button>
            </>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={uploading ? "Uploading…" : "Message the agent…"}
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
              disabled={!input.trim() && attachments.length === 0}
              className="bg-ink text-on-primary h-12 shrink-0 rounded-full px-6 text-[16px] font-semibold transition hover:opacity-85 disabled:opacity-30"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
