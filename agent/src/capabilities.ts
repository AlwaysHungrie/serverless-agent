import type { Config, Memory, SessionRegistry } from "./registry";

/**
 * A capability is something the agent can *do* beyond producing text: reach the web,
 * read a file, see an image, draw one, hear an audio clip, do work later, remember.
 *
 * Two kinds live here:
 *
 * - Tool capabilities (`tools` non-empty) hand the model functions it may call. They
 *   run inside the tool loop in `agent.ts`.
 * - Input capabilities (`tools` empty) change what a turn may carry in — files,
 *   images, audio — and are applied when the turn's messages are assembled.
 *
 * The metadata is shipped to the frontend as-is, so the capabilities page never has
 * to keep its own copy of what exists or what a capability needs to work.
 */
export type CapabilityId =
  | "web_search"
  | "url_fetch"
  | "file_ingest"
  | "vision"
  | "image_generation"
  | "audio_input"
  | "scheduled_tasks"
  | "memory";

/** A credential or endpoint the user fills in on the capabilities page. */
export type CapabilityField = {
  key: keyof Config;
  label: string;
  hint: string;
  /** Secrets are write-only over the API: reads return a mask, not the value. */
  secret: boolean;
  /** A capability with an empty required field is enabled but cannot run. */
  required: boolean;
  placeholder?: string;
};

export type Capability = {
  id: CapabilityId;
  /** The config column that switches it on. */
  flag: keyof Config;
  label: string;
  summary: string;
  /** What it costs or risks, shown under the toggle. */
  note: string;
  tools: string[];
  fields: CapabilityField[];
};

export const CAPABILITIES: Capability[] = [
  {
    id: "web_search",
    flag: "cap_web_search",
    label: "Web search",
    summary: "Search the live web and answer from the results, with links.",
    note: "Runs only when the model decides it needs to. Each search is a Brave API call.",
    tools: ["web_search"],
    fields: [
      {
        key: "brave_api_key",
        label: "Brave Search API key",
        hint: "From api-dashboard.search.brave.com. The free tier allows one query a second.",
        secret: true,
        required: true,
        placeholder: "BSA…",
      },
    ],
  },
  {
    id: "url_fetch",
    flag: "cap_url_fetch",
    label: "Read a URL",
    summary: "Open a link you paste, or one it found, and read the page text.",
    note: "No key needed. Only public pages: the Worker sends no cookies.",
    tools: ["fetch_url"],
    fields: [],
  },
  {
    id: "file_ingest",
    flag: "cap_file_ingest",
    label: "File ingest",
    summary: "Attach text, Markdown, CSV, JSON or source files and ask about them.",
    note: "Text formats only, up to 1 MB each. The text is stored in the session and resent with the turn.",
    tools: [],
    fields: [],
  },
  {
    id: "vision",
    flag: "cap_vision",
    label: "Image input",
    summary: "Attach an image and have the model look at it.",
    note: "Needs a multimodal model. Claude, GPT and Gemini see images; DeepSeek does not.",
    tools: [],
    fields: [],
  },
  {
    id: "image_generation",
    flag: "cap_image_generation",
    label: "Image generation",
    summary: "Draw an image on request and show it in the reply.",
    note: "Billed on the existing OpenRouter key, at the image model's own rate.",
    tools: ["generate_image"],
    fields: [
      {
        key: "image_model",
        label: "Image model",
        hint: "Any OpenRouter model that returns images.",
        secret: false,
        required: true,
        placeholder: "google/gemini-2.5-flash-image",
      },
    ],
  },
  {
    id: "audio_input",
    flag: "cap_audio_input",
    label: "Audio input",
    summary: "Attach a voice note or recording; it is transcribed and sent as your message.",
    note: "Transcription happens once, on upload, and the text is what the model sees.",
    tools: [],
    fields: [
      {
        key: "transcription_url",
        label: "Transcription endpoint",
        hint: "Any OpenAI-compatible /audio/transcriptions URL.",
        secret: false,
        required: true,
        placeholder: "https://api.openai.com/v1/audio/transcriptions",
      },
      {
        key: "transcription_key",
        label: "Transcription API key",
        hint: "Sent as a bearer token to that endpoint.",
        secret: true,
        required: true,
        placeholder: "sk-…",
      },
      {
        key: "transcription_model",
        label: "Transcription model",
        hint: "whisper-1 on OpenAI, whisper-large-v3 on Groq.",
        secret: false,
        required: true,
        placeholder: "whisper-1",
      },
    ],
  },
  {
    id: "scheduled_tasks",
    flag: "cap_scheduled_tasks",
    label: "Scheduled tasks",
    summary: "Run a prompt later, or on a cron, and post the answer into this session.",
    note: "Wakes the Durable Object on a timer, so a scheduled turn bills like any other.",
    tools: ["schedule_task", "list_scheduled_tasks", "cancel_scheduled_task"],
    fields: [],
  },
  {
    id: "memory",
    flag: "cap_memory",
    label: "Memory",
    summary: "Keep facts worth carrying between sessions, and look them up later.",
    note: "Memories are app-wide: every session can read what any session stored.",
    tools: ["remember", "recall"],
    fields: [],
  },
];

/** What a secret reads back as, so a key shows as set without being handed out. */
export const SECRET_MASK = "••••••••";

export const CAPABILITY_BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

/** Whether a capability is switched on *and* has everything it needs to run. */
export function capabilityReady(capability: Capability, config: Config): boolean {
  if (!config[capability.flag]) return false;
  return capability.fields.every((f) => !f.required || String(config[f.key] ?? "").trim() !== "");
}

export function enabled(config: Config, id: CapabilityId): boolean {
  const capability = CAPABILITY_BY_ID.get(id);
  return capability ? capabilityReady(capability, config) : false;
}

/* ------------------------------------------------------------------ tools -- */

export type ScheduledTask = { id: string; prompt: string; when: string };

/**
 * What a tool is allowed to touch. The agent supplies it: tools stay pure functions
 * of their arguments plus this context, which keeps them testable and keeps the
 * Durable Object's internals out of the tool code.
 */
export type ToolContext = {
  config: Config;
  sessionId: string;
  /** The Worker's OpenRouter key, for tools that call a model of their own. */
  openrouterKey: string;
  registry: DurableObjectStub<SessionRegistry>;
  /** Stores an image and returns a URL this session can serve it from. */
  saveImage: (dataUrl: string, prompt: string) => string;
  schedule: (when: string, prompt: string) => Promise<ScheduledTask>;
  listTasks: () => ScheduledTask[];
  cancelTask: (id: string) => boolean;
};

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
};

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/** Rough HTML-to-text: enough for a model to read a page, cheap enough for a Worker. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export const TOOLS: ToolSpec[] = [
  {
    name: "web_search",
    description:
      "Search the web. Use for anything current, or any fact you are not certain of. Returns titles, URLs and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        count: { type: "integer", description: "How many results, 1-10. Default 5." },
      },
      required: ["query"],
    },
    async run(args, ctx) {
      const query = str(args.query).trim();
      if (!query) return "Error: query was empty.";
      const count = Math.min(10, Math.max(1, Number(args.count) || 5));
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "X-Subscription-Token": ctx.config.brave_api_key },
      });
      if (!res.ok) return `Search failed: Brave returned ${res.status} ${await res.text()}`;
      const json = (await res.json()) as {
        web?: { results?: { title: string; url: string; description?: string }[] };
      };
      const results = json.web?.results ?? [];
      if (results.length === 0) return `No results for "${query}".`;
      return results
        .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${htmlToText(r.description ?? "")}`)
        .join("\n\n");
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch a web page and return its readable text. Use after web_search when a snippet is not enough, or when the user pastes a link.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "An absolute http(s) URL." } },
      required: ["url"],
    },
    async run(args) {
      const raw = str(args.url).trim();
      let target: URL;
      try {
        target = new URL(raw);
      } catch {
        return `Error: "${raw}" is not a valid URL.`;
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return "Error: only http and https URLs can be fetched.";
      }
      const res = await fetch(target, {
        headers: { accept: "text/html,text/plain", "user-agent": "serverless-agent/1.0" },
        redirect: "follow",
      });
      if (!res.ok) return `Fetch failed: ${res.status} ${res.statusText}`;
      const type = res.headers.get("content-type") ?? "";
      const body = await res.text();
      const text = type.includes("html") ? htmlToText(body) : body;
      // A tool result this long already dominates the prompt; more would just cost.
      return text.length > 12000 ? `${text.slice(0, 12000)}\n\n[truncated]` : text;
    },
  },
  {
    name: "generate_image",
    description:
      "Draw an image from a description and show it to the user. Returns Markdown that already renders in the chat, so repeat it in your reply rather than describing the image.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to draw, in detail." },
      },
      required: ["prompt"],
    },
    async run(args, ctx) {
      const prompt = str(args.prompt).trim();
      if (!prompt) return "Error: prompt was empty.";
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.openrouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: ctx.config.image_model,
          modalities: ["image", "text"],
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) return `Image generation failed: ${res.status} ${await res.text()}`;
      const json = (await res.json()) as {
        choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
      };
      const dataUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!dataUrl) return "Image generation returned no image. Try a different image model.";
      return `Image ready. Include exactly this in your reply: ![${prompt.slice(0, 60)}](${ctx.saveImage(dataUrl, prompt)})`;
    },
  },
  {
    name: "schedule_task",
    description:
      "Run a prompt later, once or repeatedly. The answer is posted into this session when it runs.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to ask yourself when it runs." },
        when: {
          type: "string",
          description:
            "Either a delay in seconds ('900'), an ISO 8601 timestamp, or a 5-field cron expression ('0 9 * * *') for a repeating task.",
        },
      },
      required: ["prompt", "when"],
    },
    async run(args, ctx) {
      const prompt = str(args.prompt).trim();
      const when = str(args.when).trim();
      if (!prompt || !when) return "Error: both prompt and when are required.";
      try {
        const task = await ctx.schedule(when, prompt);
        return `Scheduled task ${task.id} for ${task.when}.`;
      } catch (err) {
        return `Could not schedule: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    name: "list_scheduled_tasks",
    description: "List the tasks scheduled in this session.",
    parameters: { type: "object", properties: {} },
    async run(_args, ctx) {
      const tasks = ctx.listTasks();
      if (tasks.length === 0) return "No scheduled tasks.";
      return tasks.map((t) => `${t.id} — ${t.when} — ${t.prompt}`).join("\n");
    },
  },
  {
    name: "cancel_scheduled_task",
    description: "Cancel a scheduled task by its id.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "The task id." } },
      required: ["id"],
    },
    async run(args, ctx) {
      const id = str(args.id).trim();
      return ctx.cancelTask(id) ? `Cancelled ${id}.` : `No task with id ${id}.`;
    },
  },
  {
    name: "remember",
    description:
      "Store a fact worth carrying into later sessions: a preference, a name, a decision. One fact per call, written so it still makes sense on its own.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "The fact, in one sentence." } },
      required: ["text"],
    },
    async run(args, ctx) {
      const text = str(args.text).trim();
      if (!text) return "Error: nothing to remember.";
      const memory = (await ctx.registry.remember(text.slice(0, 500), ctx.sessionId)) as Memory;
      return `Remembered (#${memory.id}): ${memory.text}`;
    },
  },
  {
    name: "recall",
    description:
      "Look up what you have remembered. Pass a word to search for, or leave the query empty for the most recent memories.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "A word or phrase to match." } },
    },
    async run(args, ctx) {
      const memories = (await ctx.registry.recall(str(args.query).trim(), 20)) as Memory[];
      if (memories.length === 0) return "Nothing remembered yet.";
      return memories.map((m) => `#${m.id} ${m.text}`).join("\n");
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** The tools to offer this turn: those belonging to a ready capability. */
export function toolsFor(config: Config): ToolSpec[] {
  return CAPABILITIES.filter((c) => capabilityReady(c, config))
    .flatMap((c) => c.tools)
    .map((name) => TOOL_BY_NAME.get(name))
    .filter((t): t is ToolSpec => !!t);
}

/** OpenRouter's `tools` array for those tools. */
export function toolDefinitions(config: Config) {
  return toolsFor(config).map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return `Error: no tool named ${name}.`;
  try {
    return await tool.run(args, ctx);
  } catch (err) {
    return `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
