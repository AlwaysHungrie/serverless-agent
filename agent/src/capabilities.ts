import type { Config, Memory, SessionRegistry } from "./registry";
import {
  McpClient,
  McpUnauthorized,
  parseHeaders,
  parseNames,
  parseTools,
  qualifiedName,
  type McpServerRow,
} from "./mcp";

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
  | "memory"
  | "telegram"
  | "whatsapp"
  | "mcp";

/** A credential or endpoint the user fills in on the capabilities page. */
export type CapabilityField = {
  key: keyof Config;
  label: string;
  hint?: string;
  /** Secrets are write-only over the API: reads return a mask, not the value. */
  secret: boolean;
  /**
   * When present the field is a fixed choice, not free text. Every model this app can
   * pick is an OpenRouter model, and OpenRouter's catalogue is far too large and too
   * uneven to type an id into: most ids would fail for the capability at hand.
   */
  options?: { value: string; label: string }[];
  /**
   * The field holds a list, one entry per line, edited as a set of chips rather than
   * as free text.
   */
  list?: boolean;
  /** A capability with an empty required field is enabled but cannot run. */
  required: boolean;
  placeholder?: string;
};

export type Capability = {
  id: CapabilityId;
  /**
   * The capability is always on and has no switch. Its own configuration decides
   * whether it does anything — MCP does nothing until a server is connected.
   */
  alwaysOn?: boolean;
  /** The config column that switches it on. */
  flag: keyof Config;
  label: string;
  summary: string;
  /** What it costs or risks, shown under the toggle. */
  note?: string;
  /**
   * A page explaining how to get the credentials this capability asks for, opened in
   * a new tab so the setup being worked through is not lost. Telegram needs no such
   * page: one message to @BotFather is the whole of it, and the hint says so.
   */
  guide?: { label: string; href: string };
  tools: string[];
  fields: CapabilityField[];
};

/**
 * The model choices offered on the capabilities page: OpenRouter ids filtered by the
 * modality each capability needs — image output, audio input — because a model without
 * it fails at the API call, not at the setting. Cheapest first.
 */
const IMAGE_MODELS = [
  { value: "google/gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite — cheapest" },
  { value: "google/gemini-2.5-flash-image", label: "Nano Banana (Gemini 2.5 Flash)" },
  { value: "google/gemini-3.1-flash-image", label: "Nano Banana 2 (Gemini 3.1 Flash)" },
  { value: "google/gemini-3-pro-image", label: "Nano Banana Pro — best quality" },
  { value: "openai/gpt-5-image-mini", label: "GPT-5 Image Mini" },
  { value: "openai/gpt-5-image", label: "GPT-5 Image" },
];

const TRANSCRIPTION_MODELS = [
  { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite — cheapest" },
  { value: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
  { value: "google/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  { value: "mistralai/voxtral-small-24b-2507", label: "Voxtral Small 24B — speech-native" },
  { value: "openai/gpt-audio-mini", label: "GPT Audio Mini" },
  { value: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash — best quality" },
];

/**
 * What the whitelists start out as the first time Telegram is switched on. A list
 * that is empty lets everyone in, so the switch would open the bot to the whole of
 * Telegram the moment it is flipped. These are placeholders that match nothing: the
 * bot is closed until the owner replaces them with the people and groups it is for.
 */
export const TELEGRAM_WHITELIST_DEFAULTS = {
  telegram_user_whitelist: "@no-user",
  telegram_group_whitelist: "-1000000000000",
} as const;

export const CAPABILITIES: Capability[] = [
  {
    id: "web_search",
    flag: "cap_web_search",
    label: "Web search",
    summary: "Get answers from the live web, with links.",
    tools: ["web_search"],
    fields: [
      {
        key: "brave_api_key",
        label: "Brave Search API key",
        secret: true,
        required: false,
        placeholder: "BSA…",
      },
      {
        key: "searxng_url",
        label: "SearXNG URL",
        hint: "Self-hosted web search fallback, used when no Brave API key is set. You can run it locally or host it on a server yourself. (Agent will need a publicly accessible URL; use a tunnel like cloudflared).",
        secret: false,
        required: false,
        placeholder: "https://local-searxng-project.trycloudflare.com",
      },
      {
        key: "searxng_token",
        label: "SearXNG token",
        hint: "API token generated by SearXNG on first run.",
        secret: true,
        required: false,
        placeholder: "",
      },
    ],
  },
  {
    id: "url_fetch",
    flag: "cap_url_fetch",
    label: "Read a URL",
    summary: "Open a link you share and read the page.",
    tools: ["fetch_url"],
    fields: [],
  },
  {
    id: "file_ingest",
    flag: "cap_file_ingest",
    label: "File ingest",
    summary: "Ask questions about files you attach.",
    note: "Markdown, CSV, JSON and code up to 1 MB; PDFs up to 8 MB.",
    tools: [],
    fields: [],
  },
  {
    id: "vision",
    flag: "cap_vision",
    label: "Image input",
    summary: "Ask questions about images you attach.",
    note: "Not available for all models.",
    tools: [],
    fields: [],
  },
  {
    id: "image_generation",
    flag: "cap_image_generation",
    label: "Image generation",
    summary: "Agent will be able to generate images when requested.",
    tools: ["generate_image"],
    fields: [
      {
        key: "image_model",
        label: "Image model",
        secret: false,
        required: true,
        options: IMAGE_MODELS,
      },
    ],
  },
  {
    id: "audio_input",
    flag: "cap_audio_input",
    label: "Audio input",
    summary: "Agent will be able to listen to voice notes and audio files.",
    tools: ["transcribe_audio"],
    fields: [
      {
        key: "transcription_model",
        label: "Transcription model",
        secret: false,
        required: true,
        options: TRANSCRIPTION_MODELS,
      },
    ],
  },
  {
    id: "scheduled_tasks",
    flag: "cap_scheduled_tasks",
    label: "Schedule tasks",
    summary: "Allow the agent to run a task at a specified time or on a recurring schedule.",
    tools: ["schedule_task", "list_scheduled_tasks", "cancel_scheduled_task"],
    fields: [],
  },
  {
    id: "telegram",
    flag: "cap_telegram",
    label: "Telegram",
    summary: "Talk to the agent on Telegram, in a DM or in a group.",
    tools: [],
    fields: [
      {
        key: "telegram_bot_token",
        label: "Bot token",
        hint: "Get a bot token by sending this message \"/newbot\" to @BotFather in Telegram.",
        secret: true,
        required: true,
        placeholder: "123456:ABC…",
      },
      {
        key: "telegram_bot_username",
        label: "Bot username",
        hint: "A Telegram bot username will begin with an @ and ends with bot",
        secret: false,
        required: true,
        placeholder: "@my_agent_bot",
      },
      {
        key: "telegram_user_whitelist",
        label: "DM whitelist",
        hint: "Usernames allowed to DM the bot. Empty list allows every user. (Wrap an entry in slashes for a regex, e.g. /^team_/)",
        secret: false,
        list: true,
        required: false,
        placeholder: "@alice",
      },
      {
        key: "telegram_group_whitelist",
        label: "Groups whitelist",
        hint: "Groups and Topics the bot can reply in. Enter group_id or group_id:topic_id (regex supported). Empty list allows every group and forum. (You can find group id and topic id by messaging @userinfobot)",
        secret: false,
        list: true,
        required: false,
        placeholder: "-1001234567890 or -1001234567890:42",
      },
    ],
  },
  {
    id: "whatsapp",
    flag: "cap_whatsapp",
    label: "WhatsApp",
    summary: "Talk to the agent on WhatsApp, please refer to setup guide below.",
    note:
      "Meta only allows a reply within 24 hours of your last message. Send anything to the number to reopen the window.",
    guide: { label: "Whatsapp setup guide", href: "/guides/whatsapp" },
    tools: [],
    fields: [
      {
        key: "whatsapp_number",
        label: "Your WhatsApp number",
        hint: "Using a number that you do not own violates Meta's and Our Terms of Service and will result in permanent account suspension.",
        secret: false,
        required: true,
        placeholder: "+91 98765 43210",
      },
      {
        key: "whatsapp_phone_number_id",
        label: "Phone number ID",
        secret: false,
        required: true,
        placeholder: "123456789012345",
      },
      {
        key: "whatsapp_waba_id",
        label: "WhatsApp Business account ID",
        hint: "Shown beside the phone number ID. Saving it subscribes your app to the account's messages, which is what makes replies arrive.",
        secret: false,
        required: true,
        placeholder: "123456789012345",
      },
      {
        key: "whatsapp_access_token",
        label: "Access token",
        secret: true,
        required: true,
        placeholder: "EAA…",
      },
      {
        key: "whatsapp_app_secret",
        label: "App secret",
        secret: true,
        required: true,
        placeholder: "32 hex characters",
      },
      {
        key: "whatsapp_verify_token",
        label: "Verify token",
        secret: false,
        required: true,
        placeholder: "a phrase only you know",
      },
    ],
  },
  {
    id: "mcp",
    flag: "cap_mcp",
    alwaysOn: true,
    label: "MCP servers",
    summary: "Connect to any external MCP server or select an MCP server template from the list below.",
    // The servers are rows, not settings, so this capability's editor is its own
    // component rather than a list of fields.
    tools: [],
    fields: [],
  },
  {
    id: "memory",
    flag: "cap_memory",
    label: "Private Memory",
    summary: "Let the agent remember facts from conversations. These facts are not shared with other agents.",
    tools: ["remember", "recall"],
    fields: [],
  },
];

/** What a secret reads back as, so a key shows as set without being handed out. */
export const SECRET_MASK = "••••••••";

export const CAPABILITY_BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

/** Whether a capability is switched on *and* has everything it needs to run. */
export function capabilityReady(capability: Capability, config: Config): boolean {
  // A capability with no switch is on regardless of what an older config row says.
  if (!capability.alwaysOn && !config[capability.flag]) return false;
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
  saveImage: (dataUrl: string, prompt: string) => Promise<string>;
  /** Transcribes a stored audio attachment by id, caching the words on its row. */
  transcribeAttachment: (id: string) => Promise<string>;
  schedule: (when: string, prompt: string) => Promise<ScheduledTask>;
  listTasks: () => ScheduledTask[];
  cancelTask: (id: string) => Promise<boolean>;
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

type SearchResult = { title: string; url: string; description?: string };

/** A self-hosted SearXNG instance. The fallback for agents with no Brave API key. Needs `formats: [json]` in its settings.yml. */
async function searxngSearch(
  base: string,
  token: string,
  query: string,
  count: number,
): Promise<SearchResult[]> {
  if (!base) throw new Error("no Brave API key and no SearXNG URL is set");
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`SearXNG returned ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return (json.results ?? [])
    .filter((r) => r.url)
    .slice(0, count)
    .map((r) => ({ title: r.title ?? r.url!, url: r.url!, description: r.content }));
}

/** Brave's hosted API. The default when a key is set. */
async function braveSearch(key: string, query: string, count: number): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
  if (!res.ok) throw new Error(`Brave returned ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { web?: { results?: SearchResult[] } };
  return json.web?.results ?? [];
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
      if (!query) throw new Error("query was empty");
      const count = Math.min(10, Math.max(1, Number(args.count) || 5));
      const brave = str(ctx.config.brave_api_key).trim();
      const results = brave
        ? await braveSearch(brave, query, count)
        : await searxngSearch(
          str(ctx.config.searxng_url).trim().replace(/\/+$/, ""),
          str(ctx.config.searxng_token).trim(),
          query,
          count,
        );
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
        throw new Error(`"${raw}" is not a valid URL`);
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new Error("only http and https URLs can be fetched");
      }
      const res = await fetch(target, {
        headers: { accept: "text/html,text/plain", "user-agent": "serverless-agent/1.0" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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
      if (!prompt) throw new Error("prompt was empty");
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
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const json = (await res.json()) as {
        choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
      };
      const dataUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!dataUrl) return "Image generation returned no image. Try a different image model.";
      return `Image ready. Include exactly this in your reply: ![${prompt.slice(0, 60)}](${await ctx.saveImage(dataUrl, prompt)})`;
    },
  },
  {
    name: "transcribe_audio",
    description:
      "Transcribe an audio attachment the user sent. The message names each clip with its id. Call this when the words matter; the transcript is cached, so calling it twice on the same clip is free.",
    parameters: {
      type: "object",
      properties: {
        attachment_id: {
          type: "string",
          description: "The id of the audio attachment, as given in the message.",
        },
      },
      required: ["attachment_id"],
    },
    async run(args, ctx) {
      const id = str(args.attachment_id).trim();
      if (!id) throw new Error("attachment_id is required");
      const transcript = await ctx.transcribeAttachment(id);
      return transcript.trim() === "" ? "The clip transcribed to nothing." : transcript;
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
      if (!prompt || !when) throw new Error("both prompt and when are required");
      const task = await ctx.schedule(when, prompt);
      return `Scheduled task ${task.id} for ${task.when}.`;
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
      return (await ctx.cancelTask(id)) ? `Cancelled ${id}.` : `No task with id ${id}.`;
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
      if (!text) throw new Error("nothing to remember");
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

/* ------------------------------------------------------------ mcp tools -- */

/**
 * A live client for one server, with its credentials applied.
 *
 * An OAuth access token that has expired (or is about to) is refreshed here and
 * written back, so a connection made weeks ago keeps working without the user being
 * sent through the provider's consent screen again.
 */
export async function mcpClientFor(
  server: McpServerRow,
  registry: DurableObjectStub<SessionRegistry>
): Promise<McpClient> {
  const headers = server.auth === "headers" ? parseHeaders(server.headers) : {};
  if (server.auth !== "oauth") return new McpClient(server.url, headers);
  // The registry owns refreshing: it holds the row, and it is the only place that can
  // keep two of this server's tools from refreshing against each other.
  const fresh = await registry.refreshMcpToken(server.id);
  return new McpClient(server.url, headers, fresh?.oauth_access_token ?? "");
}

/**
 * Run something against a server, once, and again on a fresh token if the provider
 * says the credentials are no good.
 *
 * The stored expiry is only ever a guess about someone else's state: a token can be
 * revoked, or a session ended at the provider, long before it was due to run out. So
 * the 401 is treated as the authority and the clock as the optimization, rather than
 * the other way round.
 */
export async function withMcpAuth<T>(
  server: McpServerRow,
  registry: DurableObjectStub<SessionRegistry>,
  run: (client: McpClient) => Promise<T>
): Promise<T> {
  try {
    return await run(await mcpClientFor(server, registry));
  } catch (err) {
    if (!(err instanceof McpUnauthorized) || server.auth !== "oauth") throw err;
    const refreshed = await registry.refreshMcpToken(server.id, true);
    // A refresh that cleared the tokens has already worked out why and said so in
    // words the user can act on. Carrying that up beats reporting the 401 that
    // followed it, which would only say the credentials were refused.
    if (!refreshed?.oauth_access_token) {
      throw refreshed?.last_error ? new Error(refreshed.last_error) : err;
    }
    const retried = await run(
      new McpClient(refreshed.url, {}, refreshed.oauth_access_token)
    );
    // The call works again, so whatever the card was reporting is out of date.
    if (server.last_error) await registry.noteMcpError(server.id, "");
    return retried;
  }
}

/** Whether a server is switched on and has whatever it needs to authenticate. */
export function mcpServerReady(server: McpServerRow): boolean {
  if (!server.enabled || !server.url.trim()) return false;
  if (server.auth === "oauth") return server.oauth_access_token !== "";
  return true;
}

/**
 * The tools of every connected MCP server, as tool specs the agent can register
 * alongside its own. The schemas are the server's own, passed through untouched, and
 * the list comes from the cached `tools/list` so a turn costs no extra round trip.
 */
export function mcpToolSpecs(servers: McpServerRow[]): ToolSpec[] {
  const specs: ToolSpec[] = [];
  for (const server of servers) {
    if (!mcpServerReady(server)) continue;
    const off = new Set(parseNames(server.disabled_tools));
    for (const tool of parseTools(server.tools_json)) {
      // A tool switched off is never handed to the model, so it cannot be called.
      if (off.has(tool.name)) continue;
      specs.push({
        name: qualifiedName(server, tool.name),
        description: `[${server.name}] ${tool.description ?? tool.name}`,
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
        async run(args, ctx) {
          try {
            return await withMcpAuth(server, ctx.registry, (client) =>
              client.callTool(tool.name, args)
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Without this the card would keep advertising a server whose every call
            // is failing, because only a tool sync ever wrote that field.
            await ctx.registry.noteMcpError(server.id, message);
            throw err;
          }
        },
      });
    }
  }
  return specs;
}

/** OpenRouter's `tools` array for those tools. */
export function toolDefinitions(config: Config) {
  return toolsFor(config).map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Run one tool. A failure is not thrown: the model is shown the message so it can
 * correct itself, and `ok` lets the caller tell the user when the turn ends with
 * nothing but failed tools behind it.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  /** The spec to run, for tools that live outside `TOOLS` — MCP's, for instance. */
  spec?: ToolSpec
): Promise<{ content: string; ok: boolean }> {
  const tool = spec ?? TOOL_BY_NAME.get(name);
  if (!tool) return { content: `Error: no tool named ${name}.`, ok: false };
  try {
    return { content: await tool.run(args, ctx), ok: true };
  } catch (err) {
    return {
      content: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      ok: false,
    };
  }
}
