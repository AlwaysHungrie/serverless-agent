import { DurableObject } from "cloudflare:workers";

export type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  /**
   * Hex id of this session's Durable Object. Nothing in the app reads it; it is kept
   * because it is the `objectId` needed to query Cloudflare's usage analytics by hand.
   */
  object_id: string;
};

/**
 * A single Durable Object holding the list of sessions.
 *
 * Durable Object namespaces are not enumerable — you can address an instance by name,
 * but you cannot ask Cloudflare "which instances exist". So the index lives here, in
 * one well-known object, while each session's data lives in its own SessionAgent.
 */
export class SessionRegistry extends DurableObject {
  private ready = false;

  private ensureSchema() {
    if (this.ready) return;
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         object_id TEXT NOT NULL DEFAULT ''
       )`
    );
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE sessions ADD COLUMN object_id TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Column already present.
    }
    this.ready = true;
  }

  list(): SessionRow[] {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec(`SELECT id, title, created_at, updated_at, object_id FROM sessions ORDER BY updated_at DESC`)
      .toArray() as unknown as SessionRow[];
  }

  create(id: string, title: string, objectId: string): SessionRow {
    this.ensureSchema();
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions (id, title, created_at, updated_at, object_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at,
                                     object_id = excluded.object_id`,
      id,
      title,
      now,
      now,
      objectId
    );
    return { id, title, created_at: now, updated_at: now, object_id: objectId };
  }

  touch(id: string) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`UPDATE sessions SET updated_at = ? WHERE id = ?`, Date.now(), id);
  }

  rename(id: string, title: string) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`UPDATE sessions SET title = ? WHERE id = ?`, title, id);
  }

  remove(id: string) {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`DELETE FROM sessions WHERE id = ?`, id);
  }
}
