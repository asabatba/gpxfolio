import { relations, sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Stats columns shared by `routes` (aggregate) and `tracks` (per file).
 * Distances/elevations are metres, times seconds, speeds metres per second —
 * unit conversion is a presentation concern, handled in `src/lib/format.ts`.
 */
const statsColumns = {
  distanceM: real("distance_m").notNull().default(0),
  elevationGainM: real("elevation_gain_m").notNull().default(0),
  elevationLossM: real("elevation_loss_m").notNull().default(0),
  elevationMinM: real("elevation_min_m"),
  elevationMaxM: real("elevation_max_m"),
  durationS: integer("duration_s"),
  movingTimeS: integer("moving_time_s"),
  avgSpeedMps: real("avg_speed_mps"),
  maxSpeedMps: real("max_speed_mps"),
};

/** One shareable page. */
export const routes = sqliteTable(
  "routes",
  {
    id: text("id").primaryKey(),
    /** Unguessable, URL-safe. Unlisted routes rely on this for privacy. */
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    /**
     * `public` routes appear on the homepage gallery; `unlisted` ones are
     * reachable only by their slug. Both are readable without logging in.
     */
    visibility: text("visibility", { enum: ["public", "unlisted"] })
      .notNull()
      .default("unlisted"),
    /** Free-text ("Ride", "Hike"), shown as a badge. */
    activityType: text("activity_type"),
    /** `[west, south, east, north]` covering all tracks, as JSON. */
    bbox: text("bbox", { mode: "json" }).$type<[number, number, number, number]>(),
    /** Earliest track start, for sorting the gallery chronologically. */
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    ...statsColumns,
  },
  (table) => [
    // The gallery query filters on visibility and orders by date.
    index("routes_visibility_started_idx").on(table.visibility, table.startedAt),
  ],
);

/** One uploaded GPX file within a route. A route may combine several. */
export const tracks = sqliteTable(
  "tracks",
  {
    id: text("id").primaryKey(),
    routeId: text("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    name: text("name"),
    sourceFilename: text("source_filename").notNull(),
    /** Hex colour for this track's line on the map. */
    color: text("color").notNull(),
    orderIndex: integer("order_index").notNull().default(0),

    /** Encoded polyline (precision 5) of the simplified coordinates. */
    geometry: text("geometry").notNull(),
    /**
     * Index-aligned with `geometry`. Stored as JSON arrays rather than a blob:
     * SQLite compresses poorly either way, and JSON keeps the rows readable and
     * trivially serialisable to the client.
     */
    elevations: text("elevations", { mode: "json" }).$type<number[] | null>(),
    distances: text("distances", { mode: "json" }).$type<number[]>().notNull(),
    timeOffsets: text("time_offsets", { mode: "json" }).$type<number[] | null>(),

    pointCountOriginal: integer("point_count_original").notNull(),
    pointCountStored: integer("point_count_stored").notNull(),
    bbox: text("bbox", { mode: "json" }).$type<[number, number, number, number]>(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    ...statsColumns,
  },
  (table) => [index("tracks_route_idx").on(table.routeId, table.orderIndex)],
);

/**
 * Photos attached to a route, matched to a position along the track.
 *
 * Defined ahead of the feature so the schema is already in place: the planned
 * flow is to read EXIF `DateTimeOriginal` from an upload, find the trackpoint
 * closest in time via `tracks.timeOffsets`, and store both the resolved
 * coordinates and the distance along the route. `lat`/`lon` are kept separately
 * because a photo may carry its own GPS tags, which take precedence over a
 * time-based match. Nothing reads this table yet.
 */
export const photos = sqliteTable(
  "photos",
  {
    id: text("id").primaryKey(),
    routeId: text("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    /** Which track the photo was matched against, when known. */
    trackId: text("track_id").references(() => tracks.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    caption: text("caption"),
    /** EXIF capture time, the key used to place the photo along the track. */
    takenAt: integer("taken_at", { mode: "timestamp_ms" }),
    lat: real("lat"),
    lon: real("lon"),
    /** Metres from the track start, for placing a marker on the elevation profile. */
    distanceAlongM: real("distance_along_m"),
    width: integer("width"),
    height: integer("height"),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("photos_route_idx").on(table.routeId, table.orderIndex)],
);

export const routesRelations = relations(routes, ({ many }) => ({
  tracks: many(tracks),
  photos: many(photos),
}));

export const tracksRelations = relations(tracks, ({ one }) => ({
  route: one(routes, { fields: [tracks.routeId], references: [routes.id] }),
}));

export const photosRelations = relations(photos, ({ one }) => ({
  route: one(routes, { fields: [photos.routeId], references: [routes.id] }),
  track: one(tracks, { fields: [photos.trackId], references: [tracks.id] }),
}));

export type Route = typeof routes.$inferSelect;
export type NewRoute = typeof routes.$inferInsert;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type Photo = typeof photos.$inferSelect;
export type Visibility = Route["visibility"];
