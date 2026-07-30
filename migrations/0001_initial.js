// Routes, their tracks, and the photos table the planned photo feature will use.
//
// Plain JS rather than TypeScript so `node scripts/migrate.mjs` can import it
// with no build step — see that file. Column names are snake_case here: the
// app's `CamelCasePlugin` doesn't apply to migrations, which run on their own
// plugin-free connection.
import { sql } from "kysely";

/** Columns shared by `routes` (aggregate over its tracks) and `tracks` (per file). */
function addStatsColumns(table) {
  return table
    .addColumn("distance_m", "real", (col) => col.notNull().defaultTo(0))
    .addColumn("elevation_gain_m", "real", (col) => col.notNull().defaultTo(0))
    .addColumn("elevation_loss_m", "real", (col) => col.notNull().defaultTo(0))
    .addColumn("elevation_min_m", "real")
    .addColumn("elevation_max_m", "real")
    .addColumn("duration_s", "integer")
    .addColumn("moving_time_s", "integer")
    .addColumn("avg_speed_mps", "real")
    .addColumn("max_speed_mps", "real");
}

/** Epoch milliseconds, matching how the app reads and writes timestamps. */
const nowMs = sql`(unixepoch() * 1000)`;

/** @param {import("kysely").Kysely<any>} db */
export async function up(db) {
  await addStatsColumns(
    db.schema
      .createTable("routes")
      .addColumn("id", "text", (col) => col.primaryKey())
      // Unguessable and URL-safe; unlisted routes rely on it for privacy.
      .addColumn("slug", "text", (col) => col.notNull().unique())
      .addColumn("title", "text", (col) => col.notNull())
      .addColumn("description", "text")
      .addColumn("visibility", "text", (col) => col.notNull().defaultTo("unlisted"))
      .addColumn("activity_type", "text")
      .addColumn("bbox", "text")
      .addColumn("started_at", "integer")
      .addColumn("created_at", "integer", (col) => col.notNull().defaultTo(nowMs))
      .addColumn("updated_at", "integer", (col) => col.notNull().defaultTo(nowMs)),
  ).execute();

  await addStatsColumns(
    db.schema
      .createTable("tracks")
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("route_id", "text", (col) =>
        col.notNull().references("routes.id").onDelete("cascade"),
      )
      .addColumn("name", "text")
      .addColumn("source_filename", "text", (col) => col.notNull())
      .addColumn("color", "text", (col) => col.notNull())
      .addColumn("order_index", "integer", (col) => col.notNull().defaultTo(0))
      // Encoded polyline; the series columns below are JSON, index-aligned with it.
      .addColumn("geometry", "text", (col) => col.notNull())
      .addColumn("elevations", "text")
      .addColumn("distances", "text", (col) => col.notNull())
      .addColumn("time_offsets", "text")
      .addColumn("point_count_original", "integer", (col) => col.notNull())
      .addColumn("point_count_stored", "integer", (col) => col.notNull())
      .addColumn("bbox", "text")
      .addColumn("started_at", "integer"),
  ).execute();

  await db.schema
    .createTable("photos")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("route_id", "text", (col) =>
      col.notNull().references("routes.id").onDelete("cascade"),
    )
    .addColumn("track_id", "text", (col) =>
      col.references("tracks.id").onDelete("set null"),
    )
    .addColumn("filename", "text", (col) => col.notNull())
    .addColumn("caption", "text")
    .addColumn("taken_at", "integer")
    .addColumn("lat", "real")
    .addColumn("lon", "real")
    .addColumn("distance_along_m", "real")
    .addColumn("width", "integer")
    .addColumn("height", "integer")
    .addColumn("order_index", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "integer", (col) => col.notNull().defaultTo(nowMs))
    .execute();

  // The gallery query filters on visibility and orders by date.
  await db.schema
    .createIndex("routes_visibility_started_idx")
    .on("routes")
    .columns(["visibility", "started_at"])
    .execute();

  await db.schema
    .createIndex("tracks_route_idx")
    .on("tracks")
    .columns(["route_id", "order_index"])
    .execute();

  await db.schema
    .createIndex("photos_route_idx")
    .on("photos")
    .columns(["route_id", "order_index"])
    .execute();
}

/** @param {import("kysely").Kysely<any>} db */
export async function down(db) {
  // Reverse order: `photos` and `tracks` hold the foreign keys into `routes`.
  await db.schema.dropTable("photos").execute();
  await db.schema.dropTable("tracks").execute();
  await db.schema.dropTable("routes").execute();
}
