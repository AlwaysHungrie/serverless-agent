/**
 * Bang commands: the few things you need to say to a session rather than to the model.
 *
 * They exist because the surfaces that need them most are the ones with no UI — a
 * Telegram chat has no "reset" button — and because a wedged session cannot answer a
 * question about itself. So they are handled before a turn is ever started, and behave
 * the same wherever they are typed.
 */

export type Command = "unstick" | "delete" | "new";

const COMMANDS: Command[] = ["unstick", "delete", "new"];

/**
 * The command a message is, or nothing if it is just a message.
 *
 * Only a message that is *nothing but* the command counts. Matching it anywhere in the
 * text would mean a sentence about `!delete` deletes the session, which is a bad way
 * to find out how the feature works. A leading or trailing @mention is allowed and
 * ignored: a group chat requires one to reach the bot at all.
 */
export function parseCommand(text: string): Command | null {
  const bare = text
    .replace(/@[A-Za-z0-9_]{3,}/g, " ")
    .trim()
    .toLowerCase();
  const found = COMMANDS.find((c) => bare === `!${c}`);
  return found ?? null;
}
