import type { APIEvent } from "@solidjs/start/server";
import { getRouteBySlug } from "~/lib/routes.server";
import { readTrackGpx } from "~/lib/storage";

/**
 * Serves the original uploaded GPX for a route.
 *
 * Public, like the route page itself: anyone with the link can view the route, so
 * they can also take the file. Single-track routes return the file as-is; a
 * multi-track route is merged into one GPX with a `<trk>` per track, which is
 * far more useful to a recipient than several separate downloads.
 */
export async function GET(event: APIEvent) {
  const slug = event.params.slug;
  if (!slug) return new Response("Not found", { status: 404 });

  const route = await getRouteBySlug(slug);
  if (!route || route.tracks.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  const filename = `${slug}.gpx`;

  const headers: Record<string, string> = {
    "content-type": "application/gpx+xml; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    // Immutable: a route's tracks never change in place; edits create new ids.
    "cache-control": "public, max-age=3600",
  };

  try {
    if (route.tracks.length === 1) {
      const xml = await readTrackGpx(route.id, route.tracks[0].id);
      return new Response(renameSoleTrack(xml, route.tracks[0].name), { headers });
    }

    const parts = await Promise.all(
      route.tracks.map((track) => readTrackGpx(route.id, track.id)),
    );
    return new Response(
      mergeGpx(
        parts,
        route.title,
        route.tracks.map((track) => track.name),
      ),
      { headers },
    );
  } catch {
    // The row exists but the blob is gone — a partially restored backup, say.
    return new Response("The file for this route is unavailable.", { status: 404 });
  }
}

/**
 * Concatenates the `<trk>` elements of several GPX documents into one.
 *
 * Extracted textually rather than re-serialised from our simplified points, so
 * the download keeps full original resolution and any extension data the source
 * files carried. `names` is index-aligned with `documents` and reflects any
 * rename made in the admin UI since upload, which the original XML doesn't know
 * about.
 */
function mergeGpx(documents: string[], title: string, names: Array<string | null>): string {
  const tracks: string[] = [];
  documents.forEach((doc, i) => {
    const matches = doc.match(/<trk>[\s\S]*?<\/trk>/g);
    if (!matches) return;
    // A document with more than one <trk> holds several of our tracks at once
    // (one upload can contain multiple), so there's no single name to apply —
    // leave those untouched rather than guess which block is which.
    tracks.push(...(matches.length === 1 ? [withTrackName(matches[0], names[i])] : matches));
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gpxfolio"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata>
    <name>${escapeXml(title)}</name>
  </metadata>
${tracks.join("\n")}
</gpx>
`;
}

/** Applies a rename to a single-track document's own `<trk>`, if it has exactly one. */
function renameSoleTrack(xml: string, name: string | null): string {
  const matches = xml.match(/<trk>[\s\S]*?<\/trk>/g);
  if (matches?.length !== 1) return xml;
  return xml.replace(matches[0], withTrackName(matches[0], name));
}

/** Replaces (or inserts) a `<trk>` block's `<name>` with the current DB name. */
function withTrackName(trkXml: string, name: string | null): string {
  if (!name) return trkXml;
  const escaped = escapeXml(name);
  if (/<name>[\s\S]*?<\/name>/.test(trkXml)) {
    return trkXml.replace(/<name>[\s\S]*?<\/name>/, `<name>${escaped}</name>`);
  }
  return trkXml.replace(/<trk(\s[^>]*)?>/, (match) => `${match}\n    <name>${escaped}</name>`);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
