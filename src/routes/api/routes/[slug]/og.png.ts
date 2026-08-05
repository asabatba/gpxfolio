import type { APIEvent } from "@solidjs/start/server";
import { renderRouteOgImage } from "~/lib/og-image.server";
import { getRouteBySlug } from "~/lib/routes.server";

/**
 * The link-preview image for a route page, referenced by `og:image` /
 * `twitter:image` in `r/[slug].tsx`. Public, like the route page itself and
 * the GPX/photo endpoints — an unfurl bot has no session, so this can't be
 * gated behind auth even for an unlisted route (which is otherwise reachable
 * by anyone with the link anyway).
 */
export async function GET(event: APIEvent) {
  const slug = event.params.slug;
  if (!slug) return new Response("Not found", { status: 404 });

  const route = await getRouteBySlug(slug);
  if (!route) return new Response("Not found", { status: 404 });

  const png = await renderRouteOgImage({
    title: route.title,
    activityType: route.activityType,
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    startedAt: route.startedAt,
    siteName: process.env.PUBLIC_SITE_NAME ?? "gpxfolio",
    tracks: route.tracks.map((track) => ({ geometry: track.geometry, color: track.color })),
  });

  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      // Short-lived rather than immutable: unlike the GPX download, this
      // reflects the route's *current* title/stats, which an edit can change
      // without minting a new id.
      "cache-control": "public, max-age=3600",
    },
  });
}
