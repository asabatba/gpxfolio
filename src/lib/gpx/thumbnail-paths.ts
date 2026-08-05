import { decodePolyline } from "./encode";

export interface ThumbnailTrackInput {
  geometry: string;
  color: string;
}

export interface ThumbnailPath {
  color: string;
  d: string;
}

/**
 * Projects one or more tracks' stored polylines into an SVG `<path>` `d`
 * string, scaled and centred to fill a `width`×`height` box (minus `padding`
 * on every side).
 *
 * Pure and platform-independent so it can run both in the browser
 * (`TrackThumbnail.tsx`, the gallery cards) and on the server (`og-image.ts`,
 * rasterised with `sharp` for link-preview images) from the same math — a
 * route's silhouette must look identical in both places.
 */
export function buildThumbnailPaths(
  tracks: ThumbnailTrackInput[],
  width: number,
  height: number,
  padding: number,
): ThumbnailPath[] {
  const decoded = tracks.map((track) => ({
    color: track.color,
    points: decodePolyline(track.geometry),
  }));

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const track of decoded) {
    for (const [lat, lon] of track.points) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  if (!Number.isFinite(minLat)) return [];

  // Scale longitude by cos(lat) so the shape isn't stretched east-west, then
  // fit with a single scale factor to preserve the route's real proportions.
  const latSpan = Math.max(maxLat - minLat, 1e-6);
  const lonScale = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const lonSpan = Math.max((maxLon - minLon) * lonScale, 1e-6);

  const scale = Math.min((width - padding * 2) / lonSpan, (height - padding * 2) / latSpan);
  const offsetX = (width - lonSpan * scale) / 2;
  const offsetY = (height - latSpan * scale) / 2;

  return decoded.map((track) => ({
    color: track.color,
    d: track.points
      .map(([lat, lon], i) => {
        const x = offsetX + (lon - minLon) * lonScale * scale;
        // SVG y grows downward, latitude grows upward.
        const y = offsetY + (maxLat - lat) * scale;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(""),
  }));
}
