// Applies the migrations in ./migrations to the database.
//
// Plain JS (not TypeScript) so it runs under bare `node` with no build step,
// which matters because this is the one command a deploy has to run before
// starting the server. The migration files themselves are plain JS for the
// same reason.
import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { mkdirSync, promises as fsPromises } from "node:fs";
import path, { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/gpxfolio.db");
mkdirSync(resolve(dirname(databasePath), "blobs"), { recursive: true });

const sqlite = new SQLite(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// No CamelCasePlugin here, unlike the app's connection (src/lib/db/index.ts):
// migrations spell the snake_case column names out in full, so there is
// nothing to translate.
const db = new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });

const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs: fsPromises,
    path,
    migrationFolder: resolve("./migrations"),
    // FileMigrationProvider otherwise hands a bare filesystem path to a dynamic
    // import. On Windows that's `C:\...`, which ESM rejects as an unrecognised
    // URL scheme; a file:// URL loads on every platform.
    import: (file) => import(pathToFileURL(file).href),
  }),
});

const { error, results } = await migrator.migrateToLatest();

for (const result of results ?? []) {
  if (result.status === "Success") console.log(`applied ${result.migrationName}`);
  else if (result.status === "Error") console.error(`failed ${result.migrationName}`);
}

await db.destroy();

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(`migrations applied to ${databasePath}`);
