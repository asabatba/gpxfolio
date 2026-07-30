// drizzle-kit refuses to create the database if its parent directory is
// missing, so the data directory is created before any db: script runs.
// The app does the same at startup (see src/lib/db/index.ts).
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/gpx-share.db");
const blobs = resolve(dirname(databasePath), "blobs");

mkdirSync(blobs, { recursive: true });
console.log(`data directory ready: ${dirname(databasePath)}`);
