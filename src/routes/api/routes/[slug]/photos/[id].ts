import type { APIEvent } from "@solidjs/start/server";
import { getPhoto } from "~/lib/photos.server";
import { getRouteBySlug } from "~/lib/routes.server";
import { readPhoto } from "~/lib/storage";

/**
 * Serves a route photo's bytes. Public, like the route page itself and the
 * GPX download — anyone with the route's link can already see this photo in
 * the gallery, so gating the raw bytes behind auth would add nothing.
 *
 * `?thumb=1` selects the small gallery variant; otherwise the full display
 * size is returned. Both are pre-resized JPEG (see `photos.server.ts`), so
 * there's no on-the-fly resizing cost here — just a file read.
 */
export async function GET(event: APIEvent) {
  const slug = event.params.slug;
  const photoId = event.params.id;
  if (!slug || !photoId) return new Response("Not found", { status: 404 });

  const route = await getRouteBySlug(slug);
  if (!route) return new Response("Not found", { status: 404 });

  const photo = await getPhoto(route.id, photoId);
  if (!photo) return new Response("Not found", { status: 404 });

  const url = new URL(event.request.url);
  const variant = url.searchParams.has("thumb") ? "thumb" : "full";

  try {
    const bytes = await readPhoto(route.id, photoId, variant);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/jpeg",
        "content-disposition": `inline; filename="${photo.filename.replace(/"/g, "")}"`,
        // A given photo id's bytes never change in place — only delete + re-upload, which is a new id.
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("The file for this photo is unavailable.", { status: 404 });
  }
}
