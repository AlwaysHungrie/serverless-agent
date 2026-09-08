/**
 * The Bot API, as much of it as the agent needs: read an update, pull down whatever
 * the user attached, and answer. Nothing here knows about sessions or turns.
 */

/** Telegram's own host. A local Bot API server can stand in through the Env var. */
export const TELEGRAM_API = "https://api.telegram.org";

/** The slice of Telegram's update shape this agent reads. */
export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  chat: { id: number; type: string; title?: string; username?: string; first_name?: string };
  from?: { id: number; is_bot: boolean; first_name?: string; username?: string };
  entities?: { type: string; offset: number; length: number }[];
  photo?: { file_id: string; file_size?: number; width: number; height: number }[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  voice?: { file_id: string; mime_type?: string; file_size?: number; duration: number };
  audio?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
};

/** A file named in an update, resolved to something the agent can store. */
export type TelegramFile = {
  file_id: string;
  name: string;
  mime: string;
  size: number;
};

/** Telegram rejects a message over 4096 characters, so a long reply is split. */
const MESSAGE_LIMIT = 4096;

export class Telegram {
  constructor(
    private readonly token: string,
    private readonly api: string = TELEGRAM_API
  ) {}

  private async call<T>(method: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.api}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) throw new Error(`telegram ${method}: ${json.description ?? res.status}`);
    return json.result;
  }

  /**
   * Point the bot at this Worker. The secret token comes back on every update as a
   * header, and is what makes a webhook call trustworthy.
   */
  async setWebhook(url: string, secret: string): Promise<void> {
    await this.call("setWebhook", {
      url,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
  }

  async deleteWebhook(): Promise<void> {
    await this.call("deleteWebhook", { drop_pending_updates: true });
  }

  /**
   * What Telegram thinks the webhook is: where it points, how many updates are
   * queued behind it, and why the last delivery failed. The fastest answer to "the
   * bot is not replying".
   */
  async webhookInfo(): Promise<{
    url: string;
    pending_update_count: number;
    last_error_date?: number;
    last_error_message?: string;
  }> {
    return await this.call("getWebhookInfo", {});
  }

  /** The bot's own username, so a group mention can be recognised. */
  async me(): Promise<{ id: number; username: string }> {
    return await this.call("getMe", {});
  }

  /** "Typing…", so a long turn does not look like a dropped message. */
  async typing(chatId: string): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {
      // Nothing depends on the indicator; a failure here must not fail the turn.
    });
  }

  /** Send a reply, split at Telegram's length limit. Returns the message ids sent. */
  async send(chatId: string, text: string, replyTo?: number): Promise<number[]> {
    const ids: number[] = [];
    for (const chunk of split(text)) {
      const sent = await this.call<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text: chunk,
        // Telegram's Markdown is strict enough that a stray underscore breaks the
        // whole message, so replies are sent as plain text.
        ...(replyTo && ids.length === 0
          ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }
          : {}),
      });
      ids.push(sent.message_id);
    }
    return ids;
  }

  /** Send an image the agent drew. */
  async sendPhoto(chatId: string, bytes: ArrayBuffer, name: string, caption?: string) {
    const form = new FormData();
    form.set("chat_id", chatId);
    if (caption) form.set("caption", caption.slice(0, 1000));
    form.set("photo", new Blob([bytes]), name);
    const res = await fetch(`${this.api}/bot${this.token}/sendPhoto`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`telegram sendPhoto: ${res.status} ${await res.text()}`);
  }

  /** Download a file the user sent. Telegram serves it from a one-shot path. */
  async download(fileId: string): Promise<ArrayBuffer> {
    const file = await this.call<{ file_path: string }>("getFile", { file_id: fileId });
    const res = await fetch(`${this.api}/file/bot${this.token}/${file.file_path}`);
    if (!res.ok) throw new Error(`telegram download: ${res.status}`);
    return await res.arrayBuffer();
  }
}

/** Split on paragraph, then line, then hard, so a reply breaks where it reads. */
function split(text: string): string[] {
  if (text.length <= MESSAGE_LIMIT) return [text || "…"];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > MESSAGE_LIMIT) {
    const window = rest.slice(0, MESSAGE_LIMIT);
    const cut =
      window.lastIndexOf("\n\n") > 0
        ? window.lastIndexOf("\n\n")
        : window.lastIndexOf("\n") > 0
          ? window.lastIndexOf("\n")
          : MESSAGE_LIMIT;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** The text of a message: its own, or the caption of whatever it carried. */
export function messageText(message: TelegramMessage): string {
  return (message.text ?? message.caption ?? "").trim();
}

/**
 * Files attached to one message, largest photo size only — Telegram sends a ladder of
 * thumbnails and the last entry is the full-size one.
 */
export function messageFiles(message: TelegramMessage): TelegramFile[] {
  const files: TelegramFile[] = [];
  const photo = message.photo?.[message.photo.length - 1];
  if (photo) {
    files.push({
      file_id: photo.file_id,
      name: `photo-${message.message_id}.jpg`,
      mime: "image/jpeg",
      size: photo.file_size ?? 0,
    });
  }
  if (message.document) {
    files.push({
      file_id: message.document.file_id,
      name: message.document.file_name ?? `file-${message.message_id}`,
      mime: message.document.mime_type ?? "application/octet-stream",
      size: message.document.file_size ?? 0,
    });
  }
  const clip = message.voice ?? message.audio;
  if (clip) {
    files.push({
      file_id: clip.file_id,
      name: "file_name" in clip && clip.file_name ? clip.file_name : `voice-${message.message_id}.ogg`,
      mime: clip.mime_type ?? "audio/ogg",
      size: clip.file_size ?? 0,
    });
  }
  return files;
}

/**
 * Whether the bot should answer. A direct message is always for the bot; in a group it
 * answers when named, or when the message is a reply to something it said.
 */
export function addressesBot(message: TelegramMessage, botUsername: string): boolean {
  if (message.chat.type === "private") return true;
  const text = messageText(message).toLowerCase();
  return botUsername !== "" && text.includes(`@${botUsername.toLowerCase()}`);
}

/** A chat's name, for the sidebar. */
export function chatTitle(message: TelegramMessage): string {
  const chat = message.chat;
  if (chat.title) return chat.title;
  const who = chat.first_name ?? chat.username ?? message.from?.first_name ?? "Telegram";
  return `${who} (Telegram)`;
}
