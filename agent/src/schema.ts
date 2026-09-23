/**
 * Versioned schema migrations for a Durable Object's own SQLite.
 *
 * Every object in a namespace carries its own database, so a migration does not run
 * once for a deployment — it runs once per object, lazily, the first time that object
 * is touched after the new code is live. A fleet is therefore never all on the same
 * version at the same moment, and that is fine as long as each step is written to be
 * safe against the code that ran before it.
 *
 * What this replaces: a list of `ALTER TABLE` statements each wrapped in `catch {}`.
 * That shape works, and it is why nothing has broken so far, but it has three costs.
 * A genuine failure — a malformed statement, a constraint violation, a disk error —
 * is swallowed exactly like the duplicate-column case it was meant to tolerate, and
 * the object then serves a half-built schema until some later query fails somewhere
 * unrelated. There is no record of what an object has already applied, so nothing can
 * ever run once: no backfill, no rename, no drop. And there is no way to ask how far
 * through the ladder the fleet has got.
 *
 * So: a numbered ladder, a row saying where each object stands, and errors that are
 * allowed to be errors.
 *
 * Step 0 is always the baseline — the schema as it stood when this runner was
 * introduced, still written idempotently (`CREATE TABLE IF NOT EXISTS`, tolerant
 * `ALTER`) because objects that predate the ladder already have those tables and will
 * run it anyway. Every step after 0 runs exactly once per object and may assume the
 * baseline exists. Those steps do not need to be idempotent, and should not pretend
 * to be: if one fails, it throws, the version is not advanced, and the next request
 * into that object tries again from the same rung.
 *
 * `AgentDirectory` has its own older `schema_version` table guarding the membership
 * backfill (see `migrate` in registry.ts). This runner deliberately uses a different
 * table — `schema_migrations` — so the two do not have to agree about what a number
 * means, and the older one can keep its meaning for as long as it is needed.
 */

/** The SQL surface a migration is handed. Narrower than the storage object on purpose. */
export type MigrationSql = {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
};

export type Migration = {
  /** What this step does, in a few words. Read by `schemaStatus`, and by whoever is on call. */
  readonly name: string;
  readonly up: (sql: MigrationSql) => void;
};

/** The storage context a Durable Object exposes to this runner. */
type MigrationCtx = {
  storage: {
    sql: MigrationSql;
    transactionSync<T>(fn: () => T): T;
  };
};

/**
 * Bring this object's database up to the end of `migrations`, and return the version
 * it now stands at — which is the number of steps applied, so `migrations.length`
 * unless one threw.
 *
 * Each step runs inside `transactionSync` together with the write that records it, so
 * an object is never left believing it applied a step that did not finish. A step that
 * throws propagates: the caller's request fails, loudly, on the object whose migration
 * failed and on no other.
 */
export function applyMigrations(ctx: MigrationCtx, migrations: readonly Migration[]): number {
  const sql = ctx.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     version INTEGER NOT NULL,
     applied_at INTEGER NOT NULL
   )`);

  let current = readVersion(sql);

  for (let i = current; i < migrations.length; i++) {
    const step = migrations[i];
    const next = i + 1;
    try {
      ctx.storage.transactionSync(() => {
        step.up(sql);
        sql.exec(
          `INSERT INTO schema_migrations (id, version, applied_at) VALUES (1, ?, ?)
             ON CONFLICT(id) DO UPDATE SET version = excluded.version, applied_at = excluded.applied_at`,
          next,
          Date.now()
        );
      });
    } catch (err) {
      // Name the rung. Without this the message is whatever SQLite said about a
      // statement, with no clue which migration ran it.
      throw new Error(
        `migration ${next} (${step.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
    current = next;
  }

  return current;
}

/** How far this object has got, without running anything. */
export function schemaVersion(sql: MigrationSql): number {
  return readVersion(sql);
}

function readVersion(sql: MigrationSql): number {
  const row = sql.exec(`SELECT version FROM schema_migrations WHERE id = 1`).toArray()[0];
  return Number(row?.version ?? 0);
}

/**
 * `ALTER TABLE ... ADD COLUMN`, tolerating only the column already being there.
 *
 * The baseline step needs this: objects created before a column existed have to get
 * it, objects created after already have it, and both run the same statement. Every
 * other error — a bad type, a bad default, a missing table — is re-thrown, which is
 * the whole difference from the bare `catch {}` this replaces.
 *
 * Steps after the baseline run once and should call `sql.exec` directly. A duplicate
 * column there means the ladder is wrong, and that is worth a failure.
 */
export function addColumnIfMissing(sql: MigrationSql, table: string, column: string): void {
  try {
    sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (message.includes("duplicate column")) return;
    throw err;
  }
}
