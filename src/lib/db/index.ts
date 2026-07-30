import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { databasePath } from "../storage";
import * as schema from "./schema";

/**
 * A single long-lived connection, cached across dev-server hot reloads.
 *
 * Vite re-evaluates modules on every change; without this global the process
 * would accumulate SQLite handles until it ran out of file descriptors.
 */
const globalForDb = globalThis as unknown as {
  __gpxShareDb?: ReturnType<typeof createDb>;
};

function createDb() {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);

  // WAL lets a read (someone viewing a route) proceed while a write (an upload)
  // is in flight, instead of returning SQLITE_BUSY.
  sqlite.pragma("journal_mode = WAL");
  // Wait for a lock rather than failing immediately under concurrent access.
  sqlite.pragma("busy_timeout = 5000");
  // Off by default in SQLite; required for the cascade deletes in the schema.
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
}

export const db = globalForDb.__gpxShareDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__gpxShareDb = db;
}

export { schema };
