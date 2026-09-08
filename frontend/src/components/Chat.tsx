"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  FileText,
  GitBranch,
  Mic,
  Paperclip,
  Pause,
  Play,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ChatUIMessage,
  FilesData,
  MetaData,
  ToolData,
} from "@/app/api/sessions/[id]/chat/route";
import {
  capabilityReady,
  type Attachment,
  type Capability,
  type Config,
  type StoredMessage,
  type UsageData,
} from "@/lib/agent";
import { formatMs, formatUsd } from "@/lib/format";
import { fitImage } from "@/lib/image";
import { startRecording, type Recorder } from "@/lib/recorder";

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
  const pair = TOOL_LABELS[tool.name] ?? [
    `Running ${tool.name}…`,
    `Ran ${tool.name}`,
  ];
  return tool.done ? pair[1] : pair[0];
}

function UsageLine({ usage }: { usage: UsageData }) {
  return (
    <div className="border-hairline-soft text-faint tnum mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-[12px] leading-[1.33]">
      <span>
        {usage.prompt_tokens} + {usage.completion_tokens} tkns
      </span>
      <span className="text-ink font-semibold">
        {formatUsd(usage.cost_usd)}
      </span>
      <span>{formatMs(usage.llm_ms)}</span>
    </div>
  );
}

/** Where the browser reads an attachment's bytes from. */
function formatChars(chars: number) {
  return chars >= 1000
    ? `${(chars / 1000).toFixed(1)}k chars`
    : `${chars} chars`;
}

function fileUrl(sessionId: string, id: string) {
  return `/api/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(id)}`;
}

/**
 * Markdown, rendered with an explicit component map rather than a prose plugin, so
 * every element lands on the same monochrome scale as the rest of the app.
 */
const MARKDOWN_COMPONENTS = (sessionId: string) => ({
  p: (props: React.ComponentProps<"p">) => (
    <p className="my-2 first:mt-0 last:mb-0" {...props} />
  ),
  ul: (props: React.ComponentProps<"ul">) => (
    <ul className="my-2 list-disc space-y-1 pl-5" {...props} />
  ),
  ol: (props: React.ComponentProps<"ol">) => (
    <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />
  ),
  li: (props: React.ComponentProps<"li">) => (
    <li className="leading-[1.5]" {...props} />
  ),
  h1: (props: React.ComponentProps<"h1">) => (
    <h1 className="mt-4 mb-2 text-[20px]" {...props} />
  ),
  h2: (props: React.ComponentProps<"h2">) => (
    <h2 className="mt-4 mb-2 text-[18px]" {...props} />
  ),
  h3: (props: React.ComponentProps<"h3">) => (
    <h3 className="mt-3 mb-1 text-[16px]" {...props} />
  ),
  a: (props: React.ComponentProps<"a">) => (
    <a
      className="underline underline-offset-2"
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  strong: (props: React.ComponentProps<"strong">) => (
    <strong className="font-semibold" {...props} />
  ),
  hr: () => <hr className="border-hairline-soft my-4" />,
  blockquote: (props: React.ComponentProps<"blockquote">) => (
    <blockquote
      className="border-hairline my-2 border-l-2 pl-4 italic"
      {...props}
    />
  ),
  code: ({ className, ...props }: React.ComponentProps<"code">) =>
    // Fenced code arrives wrapped in <pre>, which carries the block styling; only
    // inline code needs its own chip.
    className?.includes("language-") ? (
      <code className={className} {...props} />
    ) : (
      <code
        className="bg-canvas-soft rounded px-1.5 py-0.5 text-[14px]"
        {...props}
      />
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
    <th
      className="border-hairline-soft border-b px-3 py-2 text-left font-semibold"
      {...props}
    />
  ),
  td: (props: React.ComponentProps<"td">) => (
    <td
      className="border-hairline-soft border-b px-3 py-2 align-top"
      {...props}
    />
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

/** A voice note is stored as a text attachment; only its mime type gives it away. */
function isAudio(a: Attachment) {
  return a.mime.startsWith("audio/") || a.mime.startsWith("video/");
}

/**
 * How long one take may run. 16 kHz mono PCM is 32 kB a second, so ten minutes is
 * about 19 MB — inside the Worker's audio ceiling. The take is stopped and kept at
 * the cap rather than split: a transcript cut across two requests loses the sentence
 * that straddles them.
 */
const MAX_RECORDING_SECONDS = 600;

/**
 * The Worker's image ceiling, less a margin for the multipart envelope. An image over
 * this is re-encoded in the browser rather than refused: see `fitImage`.
 */
const MAX_IMAGE_BYTES = 9_500_000;

/** m:ss, for player positions and durations. */
function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The wall-clock time a message was sent, without the date the sidebar already shows. */
function timeOfDay(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A fixed bar pattern per clip. Real amplitudes would mean decoding the whole file in
 * the browser; a stable pseudo-random figure reads the same way and costs nothing.
 */
function bars(id: string, count = 34) {
  let seed = 0;
  for (let i = 0; i < id.length; i++)
    seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  return Array.from({ length: count }, () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return 0.25 + ((seed >>> 16) % 1000) / 1000 / 1.35;
  });
}

/** Play/scrub a voice note in place, with its transcript underneath. */
function VoiceNote({
  attachment,
  sessionId,
  isUser,
}: {
  attachment: Attachment;
  sessionId: string;
  isUser: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [total, setTotal] = useState(0);
  const shape = useMemo(() => bars(attachment.id), [attachment.id]);
  const progress = total > 0 ? at / total : 0;

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audio.current;
    if (!el || !total) return;
    const box = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - box.left) / box.width) * total;
  };

  return (
    <div
      className={`w-fit max-w-full rounded-[14px] px-3 py-2.5 ${isUser ? "bg-white/10" : "bg-field"}`}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          aria-label={
            playing ? `Pause ${attachment.name}` : `Play ${attachment.name}`
          }
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            isUser ? "bg-white/20" : "bg-ink text-on-primary"
          }`}
        >
          {playing ? (
            <Pause size={14} strokeWidth={2} fill="currentColor" />
          ) : (
            <Play
              size={14}
              strokeWidth={2}
              fill="currentColor"
              className="ml-0.5"
            />
          )}
        </button>

        <div
          onClick={seek}
          // Fixed width, not flex-1: the card is w-fit, so a basis-0 track would
          // contribute nothing to the intrinsic width and collapse to no bars.
          className="flex h-9 w-48 max-w-full shrink-0 cursor-pointer items-center gap-px"
        >
          {shape.map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-full"
              style={{
                height: `${Math.round(h * 26)}px`,
                backgroundColor: "currentColor",
                opacity: i / shape.length <= progress ? 0.9 : 0.28,
              }}
            />
          ))}
        </div>

        <span
          className={`tnum shrink-0 text-[12px] leading-[1.33] ${isUser ? "opacity-70" : "text-faint"}`}
        >
          {clock(playing || at > 0 ? total - at : total)}
        </span>
      </div>

      {attachment.preview && (
        <p
          className={`mt-2 text-[13px] leading-[1.4] ${isUser ? "opacity-70" : "text-muted"}`}
        >
          {attachment.preview}
        </p>
      )}

      <audio
        ref={audio}
        src={fileUrl(sessionId, attachment.id)}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setAt(0);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          setTotal(Number.isFinite(d) ? d : 0);
        }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
      />
    </div>
  );
}

/** Attachments queued in the composer: images as thumbnails, files as chips. */
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
            {isAudio(a) ? (
              <Mic size={13} strokeWidth={1.75} className="shrink-0" />
            ) : (
              <FileText size={13} strokeWidth={1.75} className="shrink-0" />
            )}
            <span className="max-w-[200px] truncate">
              {isAudio(a) ? "Voice note" : a.name}
            </span>
            {!isAudio(a) && (
              <span className="text-faint tnum">{formatChars(a.chars)}</span>
            )}
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

/**
 * Non-image attachments on a sent message: a full-width card per file, tinted to sit
 * on whichever bubble it lands in, rather than the composer's light pill.
 */
function MessageDocs({
  docs,
  isUser,
  sessionId,
}: {
  docs: Attachment[];
  isUser: boolean;
  sessionId: string;
}) {
  if (docs.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {docs.map((a) =>
        isAudio(a) ? (
          <VoiceNote
            key={a.id}
            attachment={a}
            sessionId={sessionId}
            isUser={isUser}
          />
        ) : (
          <div
            key={a.id}
            className={`flex w-fit max-w-full gap-3 rounded-[14px] px-3 py-2.5 ${
              a.preview ? "items-start" : "items-center"
            } ${isUser ? "bg-white/10" : "bg-field"}`}
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${
                isUser ? "bg-white/15" : "bg-canvas border-hairline-soft border"
              }`}
            >
              <FileText size={16} strokeWidth={1.75} />
            </span>
            <span className="min-w-0 max-w-[320px] flex-1">
              <span className="block truncate text-[14px] leading-[1.35]">
                {a.name}
              </span>
              <span
                className={`tnum block text-[12px] leading-[1.33] ${isUser ? "opacity-60" : "text-faint"}`}
              >
                {formatChars(a.chars)}
              </span>
              {a.preview && (
                <span
                  className={`mt-1.5 block max-h-[4.2em] overflow-hidden font-mono text-[12px] leading-[1.4] whitespace-pre-wrap ${
                    isUser ? "opacity-60" : "text-muted"
                  }`}
                >
                  {a.preview}
                </span>
              )}
            </span>
          </div>
        ),
      )}
    </div>
  );
}

/**
 * Images on a sent message, laid out the way a messaging app does it: flush to the
 * bubble edge, one large frame for a single image and a square grid beyond that.
 */
function MessageMedia({
  images,
  sessionId,
}: {
  images: Attachment[];
  sessionId: string;
}) {
  if (images.length === 0) return null;
  const single = images.length === 1;
  return (
    <div className={single ? "" : "grid grid-cols-2 gap-1"}>
      {images.map((a) => (
        <span key={a.id} className="group relative block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl(sessionId, a.id)}
            alt={a.name}
            className={`block w-full rounded-[16px] bg-black/[0.06] ${
              single
                ? "max-h-[360px] object-contain"
                : "aspect-square object-cover"
            }`}
          />
        </span>
      ))}
    </div>
  );
}

/**
 * Anything that is neither the user nor the agent talking: a dropped stream, a failed
 * turn. Centred and quiet, so it never reads as a message someone sent.
 */
function SystemNotice({
  text,
  onRetry,
}: {
  text: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex justify-center">
      <div className="border-hairline-soft text-muted flex max-w-md items-center gap-2.5 rounded-full border px-4 py-2 text-[13px] leading-[1.35]">
        <AlertCircle size={14} strokeWidth={1.75} className="shrink-0" />
        <span className="min-w-0">{text}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-ink shrink-0 font-medium underline underline-offset-2"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

/** Pull an attachment down. Same-origin, so the browser saves it under its own name. */
function DownloadLink({
  sessionId,
  attachment,
  className = "",
}: {
  sessionId: string;
  attachment: Attachment;
  className?: string;
}) {
  return (
    <a
      href={fileUrl(sessionId, attachment.id)}
      download={attachment.name}
      title={`Download ${attachment.name}`}
      aria-label={`Download ${attachment.name}`}
      className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 ${className}`}
    >
      <Download size={13} strokeWidth={1.75} />
    </a>
  );
}

/** Three dots, while the agent has been asked something but has not started writing. */
function Thinking() {
  return (
    <span className="flex h-[1.38em] items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="bg-muted h-1.5 w-1.5 animate-bounce rounded-full"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: "900ms" }}
        />
      ))}
    </span>
  );
}

/**
 * What sits under a message: when it was sent, and what can be done with it. Kept
 * outside the bubble so the bubble stays the message and nothing else.
 */
function MessageActions({
  text,
  at,
  isUser,
  sessionId,
  downloads,
  onFork,
  onRetry,
}: {
  text: string;
  at: number | null;
  isUser: boolean;
  sessionId: string;
  /** Everything sent with this message that has a file behind it. */
  downloads: Attachment[];
  onFork?: () => void;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access denied: nothing useful to say, and nothing to undo.
    }
  };

  const action =
    "text-faint hover:text-ink flex items-center gap-1 rounded-full px-1.5 py-0.5";

  return (
    <div
      className={`text-faint flex items-center gap-1 px-1 text-[12px] leading-[1.33] ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      {onRetry && (
        <button onClick={onRetry} className={action} title="Ask again">
          <RotateCcw size={13} strokeWidth={1.75} />
        </button>
      )}
      {at !== null && <span className="tnum pr-1.5">{timeOfDay(at)}</span>}
      {text.trim() !== "" && (
        <button
          onClick={() => void copy()}
          className={action}
          title="Copy message"
        >
          {copied ? (
            <Check size={13} strokeWidth={2} />
          ) : (
            <Copy size={13} strokeWidth={1.75} />
          )}
        </button>
      )}
      {downloads.map((a) => (
        <DownloadLink
          key={a.id}
          sessionId={sessionId}
          attachment={a}
          className="text-faint hover:text-ink"
        />
      ))}
      {onFork && (
        <button
          onClick={onFork}
          className={action}
          title="Start a new session from the conversation up to this reply"
        >
          <GitBranch size={13} strokeWidth={1.75} />
          <span>Fork</span>
        </button>
      )}
    </div>
  );
}

/**
 * One message: its files above, the bubble itself, and its actions below. Voice notes
 * and documents sit outside the bubble — a clip with nothing said alongside it should
 * not be dressed up as a sentence — while images stay inside it, inset from the edge.
 */
function Bubble({
  message,
  sessionId,
  at,
  pending = false,
  onFork,
  onRetry,
}: {
  message: ChatUIMessage;
  sessionId: string;
  at: number | null;
  /** The turn is in flight: the bubble stands even before the first token lands. */
  pending?: boolean;
  onFork?: () => void;
  onRetry?: () => void;
}) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  const usage = message.parts.find((p) => p.type === "data-usage") as
    { type: "data-usage"; data: UsageData } | undefined;
  const tools = message.parts.filter(
    (p): p is { type: "data-tool"; id?: string; data: ToolData } =>
      p.type === "data-tool",
  );
  const files = message.parts.find((p) => p.type === "data-files") as
    { type: "data-files"; data: FilesData } | undefined;

  const attachments = files?.data.attachments ?? [];
  const images = attachments.filter((a) => a.kind === "image");
  const docs = attachments.filter((a) => a.kind !== "image");
  // The bubble is for what was said. Files carry themselves.
  const hasBubble =
    text.length > 0 ||
    tools.length > 0 ||
    images.length > 0 ||
    (!isUser && (usage !== undefined || pending));

  return (
    <div
      className={`flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}
    >
      {docs.length > 0 && (
        <div className="max-w-2xl">
          <MessageDocs docs={docs} isUser={false} sessionId={sessionId} />
        </div>
      )}

      {hasBubble && (
        <div
          className={`max-w-2xl overflow-hidden rounded-[24px] text-[16px] leading-[1.38] ${
            isUser
              ? "bg-ink text-on-primary"
              : "bg-canvas border-hairline-soft text-ink border"
          }`}
        >
          {images.length > 0 && (
            <div className={text.length > 0 ? "p-2 pb-0" : "p-2"}>
              <MessageMedia images={images} sessionId={sessionId} />
            </div>
          )}

          {(text.length > 0 ||
            tools.length > 0 ||
            (!isUser && (usage || pending))) && (
            <div className="px-6 py-5">
              {tools.length > 0 && (
                <div className="text-faint mb-3 space-y-1 text-[12px] leading-[1.33]">
                  {tools.map((t, i) => (
                    <div key={t.id ?? i}>{toolLabel(t.data)}</div>
                  ))}
                </div>
              )}

              {isUser ? (
                text.length > 0 && (
                  <div className="whitespace-pre-wrap">{text}</div>
                )
              ) : text ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={MARKDOWN_COMPONENTS(sessionId)}
                >
                  {text}
                </ReactMarkdown>
              ) : (
                <Thinking />
              )}

              {!isUser && usage && <UsageLine usage={usage.data} />}
            </div>
          )}
        </div>
      )}

      <MessageActions
        text={text}
        at={at}
        isUser={isUser}
        sessionId={sessionId}
        downloads={attachments}
        onFork={onFork}
        onRetry={onRetry}
      />
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
            { type: "data-meta" as const, data: { ts: row.ts } },
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
            { type: "data-meta" as const, data: { ts: row.ts } },
            ...(row.attachments?.length
              ? [
                  {
                    type: "data-files" as const,
                    data: { attachments: row.attachments },
                  },
                ]
              : []),
            { type: "text" as const, text: row.content },
          ],
  }));
}

/** The file types the attach button offers, given which input capabilities are on. */
function acceptFor(ready: Set<string>): string {
  const accept: string[] = [];
  if (ready.has("file_ingest"))
    accept.push(
      "text/*",
      ".md",
      ".csv",
      ".json",
      ".yaml",
      ".ts",
      ".tsx",
      ".py",
    );
  if (ready.has("vision")) accept.push("image/*");
  // OpenRouter takes WAV and MP3 audio; other containers are rejected on upload.
  if (ready.has("audio_input"))
    accept.push("audio/wav", "audio/mpeg", ".wav", ".mp3");
  return accept.join(",");
}

export function Chat({
  sessionId,
  initialMessages,
  onTurnEnd,
  onFork,
}: {
  sessionId: string;
  initialMessages: StoredMessage[];
  onTurnEnd: () => void;
  /** Branch the conversation: the first `count` messages become a new session. */
  onFork: (count: number) => void;
}) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  /** Seconds into the current take, or null when the mic is idle. */
  const [recordedFor, setRecordedFor] = useState<number | null>(null);
  // Local previews shown while a file is still on its way to the Worker.
  const [ghosts, setGhosts] = useState<
    { key: string; name: string; preview: string | null }[]
  >([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ready, setReady] = useState<Set<string>>(new Set());
  // A message streamed in this session has no stored timestamp yet, so the arrival
  // time is recorded once, when the message first appears. It lives in a plain map
  // rather than in state: writing it must not itself cause a render.
  const [seen] = useState(() => new Map<string, number>());
  const bottom = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Which input capabilities are usable decides what may be attached at all.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/config");
      const payload = (await res.json().catch(() => null)) as {
        config: Config;
        capabilities: Capability[];
      } | null;
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
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/files`,
      );
      const payload = (await res.json().catch(() => null)) as {
        attachments?: Attachment[];
      } | null;
      setAttachments(payload?.attachments ?? []);
    })();
  }, [sessionId]);

  const { messages, sendMessage, regenerate, stop, status, error } =
    useChat<ChatUIMessage>({
      id: sessionId,
      messages: toUIMessages(initialMessages),
      transport: new DefaultChatTransport({
        api: `/api/sessions/${encodeURIComponent(sessionId)}/chat`,
      }),
      onFinish: onTurnEnd,
    });

  const streaming = status === "streaming" || status === "submitted";
  const recording = recordedFor !== null;
  const canAttach =
    ready.has("file_ingest") || ready.has("vision") || ready.has("audio_input");

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Stamp anything the transcript did not arrive with a time for.
  useEffect(() => {
    const now = Date.now();
    for (const m of messages) if (!seen.has(m.id)) seen.set(m.id, now);
  }, [messages, seen]);

  const remove = async (id: string) => {
    setAttachments((a) => a.filter((x) => x.id !== id));
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files/${id}`, {
      method: "DELETE",
    });
  };

  const upload = async (picked: File[]) => {
    setUploading(true);
    setUploadError(null);
    for (const original of picked) {
      const isImage = original.type.startsWith("image/");
      const key = `${original.name}-${nextKey.current++}`;
      // An image can be previewed from the browser's own copy straight away, so the
      // thumbnail appears on pick rather than after the round trip — and before the
      // re-encode below, which on a large photo takes a moment of its own.
      const preview = isImage ? URL.createObjectURL(original) : null;
      setGhosts((g) => [...g, { key, name: original.name, preview }]);

      // A photo off a phone is routinely past the ceiling; shrink it rather than
      // sending the user away to resize it. Anything that cannot be shrunk is sent
      // as it is, so the Worker's own message is what they see.
      const file = isImage
        ? ((await fitImage(original, MAX_IMAGE_BYTES)) ?? original)
        : original;

      const form = new FormData();
      form.set("file", file);
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/files`,
        {
          method: "POST",
          body: form,
        },
      );
      const payload = (await res.json().catch(() => null)) as {
        attachment?: Attachment;
        error?: string;
      } | null;

      setGhosts((g) => g.filter((x) => x.key !== key));
      if (preview) URL.revokeObjectURL(preview);

      // Cancelled while it was in flight: the Worker has already stored it, so the
      // tidying happens here rather than being left behind.
      if (cancelled.current.has(key)) {
        cancelled.current.delete(key);
        if (payload?.attachment) void remove(payload.attachment.id);
        continue;
      }

      if (!res.ok || !payload?.attachment) {
        setUploadError(payload?.error ?? `Could not upload ${file.name}.`);
        continue;
      }
      setAttachments((a) => [...a, payload.attachment!]);
    }
    setUploading(false);
  };

  /** Counter behind the ghost keys: unique per pick, without reading the clock. */
  const nextKey = useRef(0);

  /** Uploads dropped by the user before the Worker answered. */
  const cancelled = useRef(new Set<string>());

  /** Take a pending upload off the strip; its row is deleted when it lands. */
  const cancelUpload = (key: string) => {
    cancelled.current.add(key);
    setGhosts((g) => {
      const ghost = g.find((x) => x.key === key);
      if (ghost?.preview) URL.revokeObjectURL(ghost.preview);
      return g.filter((x) => x.key !== key);
    });
  };

  /** Hold the live recorder outside React state: it is a handle, not rendered data. */
  const recorder = useRef<Recorder | null>(null);

  const record = async () => {
    setUploadError(null);
    try {
      recorder.current = await startRecording();
      setRecordedFor(0);
    } catch {
      setUploadError(
        "No microphone. Check the browser's permission for this site.",
      );
    }
  };

  const finishRecording = async (keep: boolean) => {
    const active = recorder.current;
    recorder.current = null;
    setRecordedFor(null);
    if (!active) return;
    if (!keep) {
      active.cancel();
      return;
    }
    try {
      const clip = await active.stop();
      if (clip) await upload([clip]);
    } catch {
      setUploadError("Could not encode the recording.");
    }
  };

  // Advance the counter once a second while a take is running, and never otherwise.
  // At the ceiling the take is stopped and kept, rather than left running into a clip
  // the Worker would reject.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      setRecordedFor((s) => (s ?? 0) + 1);
      if ((recordedFor ?? 0) + 1 >= MAX_RECORDING_SECONDS) {
        void finishRecording(true);
      }
    }, 1000);
    return () => clearInterval(id);
    // finishRecording is stable enough for this: it only reads refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, recordedFor]);

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
        ...(attachments.length
          ? [{ type: "data-files" as const, data: { attachments } }]
          : []),
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
            Send a message. The Durable Object wakes, streams a reply, and bills
            for the seconds it stays awake.
          </p>
        )}
        {messages.map((m, i) => {
          const stored = m.parts.find((p) => p.type === "data-meta") as
            { type: "data-meta"; data: MetaData } | undefined;
          const at = stored?.data.ts ?? seen.get(m.id) ?? null;
          const last = i === messages.length - 1;
          return (
            <Bubble
              key={m.id}
              message={m}
              sessionId={sessionId}
              at={streaming && last ? null : at}
              pending={streaming && last && m.role === "assistant"}
              // A fork replays what came before the reply, so the branch starts from
              // the same question with the answer still to be written.
              onFork={
                m.role === "assistant" && !streaming
                  ? () => onFork(i)
                  : undefined
              }
              onRetry={
                m.role === "assistant" && last && !streaming
                  ? () => void regenerate()
                  : undefined
              }
            />
          );
        })}
        {/* The reply has been asked for but the assistant message has not arrived yet. */}
        {streaming && messages[messages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className="bg-canvas border-hairline-soft rounded-[24px] border px-6 py-5">
              <Thinking />
            </div>
          </div>
        )}
        {error && (
          <SystemNotice
            text={error.message}
            onRetry={streaming ? undefined : () => void regenerate()}
          />
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
                  <span key={g.key} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={g.preview}
                      alt={g.name}
                      className="border-hairline-soft h-16 w-16 animate-pulse rounded-[12px] border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => cancelUpload(g.key)}
                      aria-label={`Cancel ${g.name}`}
                      className="bg-ink text-on-primary absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full"
                    >
                      <X size={11} strokeWidth={2.5} />
                    </button>
                  </span>
                ) : (
                  <span
                    key={g.key}
                    className="bg-field text-muted flex items-center gap-2 rounded-full py-1.5 pr-2 pl-3 text-[12px] leading-[1.33]"
                  >
                    {/* The label pulses, not the chip: the cancel button must stay solid. */}
                    <FileText
                      size={13}
                      strokeWidth={1.75}
                      className="animate-pulse"
                    />
                    <span className="max-w-[200px] animate-pulse truncate">
                      {g.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => cancelUpload(g.key)}
                      aria-label={`Cancel ${g.name}`}
                      className="text-muted hover:text-ink flex h-5 w-5 items-center justify-center rounded-full"
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </span>
                ),
              )}
            </div>
            {uploadError && (
              <p className="text-muted text-[12px]">{uploadError}</p>
            )}
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
                  if (e.target.files?.length)
                    void upload(Array.from(e.target.files));
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
          {ready.has("audio_input") && !recording && (
            <button
              type="button"
              onClick={() => void record()}
              disabled={uploading}
              title="Record a voice note"
              aria-label="Record a voice note"
              className="border-hairline text-ink hover:bg-canvas-soft flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-40"
            >
              <Mic size={18} strokeWidth={1.75} />
            </button>
          )}

          {recording ? (
            <div className="bg-field flex h-12 flex-1 items-center gap-3 rounded-[16px] px-4">
              <span className="bg-ink h-2.5 w-2.5 shrink-0 animate-pulse rounded-full" />
              <span className="text-ink tnum text-[16px]">
                {clock(recordedFor ?? 0)}
              </span>
              <span className="text-faint flex-1 text-[13px]">
                {MAX_RECORDING_SECONDS - (recordedFor ?? 0) <= 30
                  ? `Stopping in ${MAX_RECORDING_SECONDS - (recordedFor ?? 0)}s`
                  : "Recording…"}
              </span>
              <button
                type="button"
                onClick={() => void finishRecording(false)}
                className="text-muted hover:text-ink text-[13px] transition"
              >
                Discard
              </button>
            </div>
          ) : (
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={uploading ? "Uploading…" : "Message the agent…"}
              className="bg-field placeholder:text-faint text-ink focus:ring-ink h-12 flex-1 rounded-[16px] px-4 text-[16px] outline-none focus:ring-2"
            />
          )}
          {recording ? (
            <button
              type="button"
              onClick={() => void finishRecording(true)}
              title="Stop recording"
              aria-label="Stop recording"
              className="bg-ink text-on-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition hover:opacity-85"
            >
              <Square size={15} strokeWidth={2} fill="currentColor" />
            </button>
          ) : streaming ? (
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
