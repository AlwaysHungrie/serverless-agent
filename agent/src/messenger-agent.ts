import { createOpenAI } from "@ai-sdk/openai";
import { Think, type TurnConfig, type TurnContext } from "@cloudflare/think";
import { ThinkMessengerStateAgent } from "@cloudflare/think/messengers";
import telegramMessenger from "@cloudflare/think/messengers/telegram";
import { jsonSchema, tool, type ToolSet } from "ai";
import type { Env } from "./agent";
import {
  CAPABILITIES,
  enabled,
  toolsFor,
  type ScheduledTask,
  type ToolContext,
} from "./capabilities";
import { DEFAULT_CONFIG, type Config } from "./registry";

export { ThinkMessengerStateAgent };

const SYSTEM_PROMPT =
  "You are a concise assistant reachable over chat. Keep replies short enough to read on a phone.";

/**
 * The messenger agent runs the same settings and the same capability tools as the
 * browser sessions do — the registry object is the single source of truth for both,
 * so a toggle flipped in the settings panel reaches Telegram without a deploy.
 */
export class MessengerAgent extends Think<Env> {
  /** The registry row, reread at the start of every turn. */
  private settings: Config | undefined;

  private registry() {
    return this.env.SessionRegistry.get(this.env.SessionRegistry.idFromName("global"));
  }

  private config(): Config {
    return this.settings ?? { model: this.env.MODEL, ...DEFAULT_CONFIG };
  }

  /**
   * OpenRouter through the AI SDK's OpenAI-compatible client: the same account and
   * the same model ids the browser sessions bill against.
   */
  private openrouter() {
    return createOpenAI({
      apiKey: this.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }

  getModel() {
    return this.openrouter()(this.config().model);
  }

  getSystemPrompt() {
    return SYSTEM_PROMPT;
  }

  getMessengers() {
    return {
      telegram: telegramMessenger({
        token: this.env.TELEGRAM_BOT_TOKEN,
        userName: this.env.TELEGRAM_BOT_USERNAME,
        secretToken: this.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
        // One Think sub-agent per chat, so a group and a DM never share memory.
        conversation: "self",
      }),
    };
  }

  /**
   * Settings are read per turn rather than per boot: the object can live for days
   * between messages, and a stale temperature is a confusing thing to debug.
   */
  async beforeTurn(_ctx: TurnContext): Promise<TurnConfig> {
    this.settings = await this.registry().config(this.env.MODEL);
    const config = this.config();
    return {
      model: this.openrouter()(config.model),
      instructions: await this.instructions(config),
      tools: this.capabilityTools(config),
      temperature: config.temperature,
      ...(config.max_tokens > 0 ? { maxOutputTokens: config.max_tokens } : {}),
    };
  }

  private async instructions(config: Config): Promise<string> {
    const parts = [SYSTEM_PROMPT];
    const custom = config.system_prompt.trim();
    if (custom) parts.push(custom);

    if (enabled(config, "memory")) {
      const memories = await this.registry().recall("", 50);
      if (memories.length > 0) {
        parts.push(
          `What you remember about this user:\n${memories.map((m) => `- ${m.text}`).join("\n")}`
        );
      }
    }
    const ready = CAPABILITIES.filter((c) => enabled(config, c.id)).map((c) => c.label);
    if (ready.length > 0) parts.push(`Capabilities available to you: ${ready.join(", ")}.`);
    return parts.join("\n\n");
  }

  /**
   * The capability tools, wrapped for the AI SDK. Their JSON Schema is reused as is,
   * so a tool added in `capabilities.ts` reaches Telegram with no work here.
   */
  private capabilityTools(config: Config): ToolSet {
    const context = this.toolContext(config);
    const tools: ToolSet = {};
    for (const spec of toolsFor(config)) {
      tools[spec.name] = tool({
        description: spec.description,
        inputSchema: jsonSchema(spec.parameters as never),
        execute: (args) => spec.run(args as Record<string, unknown>, context),
      });
    }
    return tools;
  }

  private toolContext(config: Config): ToolContext {
    return {
      config,
      sessionId: this.name,
      openrouterKey: this.env.OPENROUTER_API_KEY,
      registry: this.registry(),
      // Generated images go to R2 and come back as a public link: a chat message
      // cannot serve a Durable Object attachment route the way the browser can.
      saveImage: async (dataUrl, prompt) => {
        const id = crypto.randomUUID().slice(0, 12);
        const mime = dataUrl.match(/^data:([^;]+)/)?.[1] ?? "image/png";
        const base64 = dataUrl.split(",", 2)[1] ?? "";
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const key = `messenger/${this.name}/${id}`;
        await this.env.FILES.put(key, bytes, {
          httpMetadata: { contentType: mime },
          customMetadata: { prompt: prompt.slice(0, 200) },
        });
        return `/messengers/files/${encodeURIComponent(key)}`;
      },
      // Voice notes arrive as messenger attachments, not as session uploads, so the
      // transcription tool has nothing to look up here.
      transcribeAttachment: async () => {
        throw new Error("audio transcription is not available over chat");
      },
      schedule: (when, prompt) => this.scheduleTask(when, prompt),
      listTasks: () => this.listTasks(),
      cancelTask: (id) => this.cancelSchedule(id) as unknown as boolean,
    };
  }

  /** "in 900 seconds", an absolute timestamp, or a five-field cron expression. */
  private async scheduleTask(when: string, prompt: string): Promise<ScheduledTask> {
    const seconds = Number(when);
    const isCron = /^[\d*/,\-\s]+$/.test(when) && when.trim().split(/\s+/).length === 5;
    let at: Date | number | string;
    if (Number.isFinite(seconds)) {
      at = seconds;
    } else if (isCron) {
      at = when.trim();
    } else {
      const date = new Date(when);
      if (Number.isNaN(date.getTime())) {
        throw new Error(`"${when}" is not a delay, a timestamp or a cron expression`);
      }
      at = date;
    }
    const schedule = await this.schedule(at as never, "runScheduledTask", { prompt });
    return { id: schedule.id, prompt, when };
  }

  private listTasks(): ScheduledTask[] {
    return [...this.getSchedules<{ prompt: string }>()].map((s) => ({
      id: s.id,
      prompt: s.payload.prompt,
      when: String(s.type === "cron" ? s.cron : new Date(s.time * 1000).toISOString()),
    }));
  }

  /**
   * A scheduled task speaks into the conversation it was scheduled from. The turn
   * is submitted rather than awaited: the alarm handler has nowhere to stream to,
   * and the durable submission survives a restart mid-inference.
   */
  async runScheduledTask(payload: { prompt: string }) {
    await this.submitMessages(
      [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: `[scheduled task] ${payload.prompt}` }],
        },
      ],
      { metadata: { source: "scheduled-task" } }
    );
  }
}
