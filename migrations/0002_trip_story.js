// Adds the "trip story" fields to `routes`: a freeform Markdown write-up plus
// two small structured facts (conditions, would-redo rating). See
// `RoutesTable` in `src/lib/db/schema.ts` for the field-by-field rationale.
/** @param {import("kysely").Kysely<any>} db */
export async function up(db) {
  await db.schema
    .alterTable("routes")
    .addColumn("story_markdown", "text")
    .execute();
  await db.schema
    .alterTable("routes")
    .addColumn("conditions", "text")
    .execute();
  // 1-5, validated in the application layer (see `updateRoute`) rather than
  // with a CHECK constraint, matching how every other input here is validated.
  await db.schema
    .alterTable("routes")
    .addColumn("would_redo_rating", "integer")
    .execute();
}

/** @param {import("kysely").Kysely<any>} db */
export async function down(db) {
  await db.schema.alterTable("routes").dropColumn("would_redo_rating").execute();
  await db.schema.alterTable("routes").dropColumn("conditions").execute();
  await db.schema.alterTable("routes").dropColumn("story_markdown").execute();
}
