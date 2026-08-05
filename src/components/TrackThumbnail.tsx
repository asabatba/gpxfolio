import { createMemo, For } from "solid-js";
import { buildThumbnailPaths } from "~/lib/gpx/thumbnail-paths";

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
 * and issues no tile requests, however many routes are listed. The projection
 * math lives in `~/lib/gpx/thumbnail-paths` so the server-rendered og:image
 * (`api/routes/[slug]/og.png.ts`) draws the exact same shape.
 */
export default function TrackThumbnail(props: TrackThumbnailProps) {
  const paths = createMemo(() => buildThumbnailPaths(props.tracks, W, H, PAD));

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
