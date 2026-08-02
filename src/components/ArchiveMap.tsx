import { createMemo, For } from "solid-js";
import { decodePolyline } from "~/lib/gpx/encode";

interface ArchiveMapProps {
  /** Encoded polylines from every public route's tracks, flattened. */
  tracks: string[];
  class?: string;
}

const W = 1200;
const H = 300;
const PAD = 20;

/**
 * Every public route's track overlaid on one plain map — a footprint of
 * everywhere recorded, not a real basemap. Same fit-to-bounds approach as
 * `TrackThumbnail`, just wider and drawn in one uniform accent colour rather
 * than per-track colours, since with many routes at once those colours no
 * longer map to anything nameable without a legend.
 */
export default function ArchiveMap(props: ArchiveMapProps) {
  const paths = createMemo(() => {
    const decoded = props.tracks.map((geometry) => decodePolyline(geometry));

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const points of decoded) {
      for (const [lat, lon] of points) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
    }
    if (!Number.isFinite(minLat)) return [];

    // Scale longitude by cos(lat) so shapes aren't stretched east-west, then fit
    // with a single scale factor to preserve real proportions across routes.
    const latSpan = Math.max(maxLat - minLat, 1e-6);
    const lonScale = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const lonSpan = Math.max((maxLon - minLon) * lonScale, 1e-6);

    const scale = Math.min((W - PAD * 2) / lonSpan, (H - PAD * 2) / latSpan);
    const offsetX = (W - lonSpan * scale) / 2;
    const offsetY = (H - latSpan * scale) / 2;

    return decoded.map((points) =>
      points
        .map(([lat, lon], i) => {
          const x = offsetX + (lon - minLon) * lonScale * scale;
          // SVG y grows downward, latitude grows upward.
          const y = offsetY + (maxLat - lat) * scale;
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(""),
    );
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      class={props.class}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <For each={paths()}>
        {(d) => (
          <path
            d={d}
            fill="none"
            style={{ stroke: "var(--accent)" }}
            stroke-width="2.5"
            stroke-linejoin="round"
            stroke-linecap="round"
            opacity="0.55"
          />
        )}
      </For>
    </svg>
  );
}
