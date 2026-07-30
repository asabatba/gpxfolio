// Applies the generated SQL migrations in ./drizzle to the database.
//
// Plain JS (not TypeScript) so it runs under bare `node` with no build step,
// which matters because this is the one command a deploy has to run before
// starting the server.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/gpxfolio.db");
mkdirSync(resolve(dirname(databasePath), "blobs"), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

migrate(drizzle(sqlite), { migrationsFolder: resolve("./drizzle") });
sqlite.close();

console.log(`migrations applied to ${databasePath}`);
