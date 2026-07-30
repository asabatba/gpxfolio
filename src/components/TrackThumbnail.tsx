import { createMemo, For } from "solid-js";
import { decodePolyline } from "~/lib/gpx/encode";

interface TrackThumbnailProps {
  tracks: Array<{ geometry: string; color: string }>;
  class?: string;
}

const W = 320;
const H = 180;
const PAD = 14;

/**
 * The route's shape as a plain SVG, drawn from the stored polyline.
 *
 * Gallery cards use this instead of a real map so the homepage renders instantly
 * and issues no tile requests, however many routes are listed.
 */
export default function TrackThumbnail(props: TrackThumbnailProps) {
  const paths = createMemo(() => {
    const decoded = props.tracks.map((track) => ({
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

    const scale = Math.min((W - PAD * 2) / lonSpan, (H - PAD * 2) / latSpan);
    const offsetX = (W - lonSpan * scale) / 2;
    const offsetY = (H - latSpan * scale) / 2;

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
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      class={props.class}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <For each={paths()}>
        {(path) => (
          <>
            {/* Casing keeps thin tracks visible against the card background. */}
            <path
              d={path.d}
              fill="none"
              stroke="var(--surface)"
              stroke-width="4.5"
              stroke-linejoin="round"
              stroke-linecap="round"
              opacity="0.55"
            />
            <path
              d={path.d}
              fill="none"
              stroke={path.color}
              stroke-width="2.25"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </>
        )}
      </For>
    </svg>
  );
}
