import SQLite from "better-sqlite3";
import { CamelCasePlugin, Kysely, SqliteDialect } from "kysely";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { databasePath } from "../storage";
import type { Database } from "./schema";

/**
 * A single long-lived connection, cached across dev-server hot reloads.
 *
 * Vite re-evaluates modules on every change; without this global the process
 * would accumulate SQLite handles until it ran out of file descriptors.
 */
const globalForDb = globalThis as unknown as {
  __gpxShareDb?: Kysely<Database>;
};

function createDb(): Kysely<Database> {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new SQLite(databasePath);

  // WAL lets a read (someone viewing a route) proceed while a write (an upload)
  // is in flight, instead of returning SQLITE_BUSY.
  sqlite.pragma("journal_mode = WAL");
  // Wait for a lock rather than failing immediately under concurrent access.
  sqlite.pragma("busy_timeout = 5000");
  // Off by default in SQLite; required for the cascade deletes in the schema.
  sqlite.pragma("foreign_keys = ON");

  return new Kysely<Database>({
    dialect: new SqliteDialect({ database: sqlite }),
    // Lets queries name columns the way the TypeScript types do; the SQL that
    // reaches SQLite still says `route_id`, `started_at`, and so on.
    plugins: [new CamelCasePlugin()],
  });
}

export const db = globalForDb.__gpxShareDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__gpxShareDb = db;
}
