import { createMemo, For, Show, type Setter } from "solid-js";
import { formatDistance, formatDuration, formatElevation } from "~/lib/format";
import type { HoverPoint, TrackView } from "~/lib/track-view";

interface ElevationProfileProps {
  tracks: TrackView[];
  hovered: () => HoverPoint | null;
  setHovered: Setter<HoverPoint | null>;
}

/** Internal drawing space; the SVG scales to its container via viewBox. */
const VIEW_W = 1000;
const VIEW_H = 220;
const PAD_LEFT = 44;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;

const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;

interface Sample {
  trackId: string;
  index: number;
  distanceM: number;
  elevationM: number;
  lon: number;
  lat: number;
  timeOffsetS: number | null;
}

/**
 * Hand-rolled SVG rather than a charting library.
 *
 * The chart's whole job is to stay in lockstep with the map, which means owning
 * the pointer-to-index lookup exactly. A generic library would add ~50 KB and
 * still need this logic bolted on the side.
 */
export default function ElevationProfile(props: ElevationProfileProps) {
  let svg!: SVGSVGElement;

  /**
   * Flattens the tracks into one distance-ordered series so a multi-track route
   * reads as a single continuous profile, with each track's distances offset by
   * the total that came before it.
   */
  const samples = createMemo<Sample[]>(() => {
    const out: Sample[] = [];
    let offset = 0;
    for (const track of props.tracks) {
      if (!track.elevations) continue;
      for (let i = 0; i < track.coordinates.length; i++) {
        const coord = track.coordinates[i];
        const elevation = track.elevations[i];
        if (coord == null || elevation == null) continue;
        out.push({
          trackId: track.id,
          index: i,
          distanceM: offset + track.distances[i],
          elevationM: elevation,
          lon: coord[0],
          lat: coord[1],
          timeOffsetS: track.timeOffsets?.[i] ?? null,
        });
      }
      offset += track.distanceM;
    }
    return out;
  });

  const extent = createMemo(() => {
    const list = samples();
    if (list.length === 0) {
      return { minEle: 0, maxEle: 1, totalM: 1 };
    }
    let minEle = Infinity;
    let maxEle = -Infinity;
    for (const s of list) {
      if (s.elevationM < minEle) minEle = s.elevationM;
      if (s.elevationM > maxEle) maxEle = s.elevationM;
    }
    // A flat route would divide by zero; give it a nominal 10 m band.
    if (maxEle - minEle < 10) {
      const mid = (maxEle + minEle) / 2;
      minEle = mid - 5;
      maxEle = mid + 5;
    }
    return {
      minEle,
      maxEle,
      totalM: Math.max(1, list[list.length - 1].distanceM),
    };
  });

  const xOf = (distanceM: number) => PAD_LEFT + (distanceM / extent().totalM) * PLOT_W;
  const yOf = (elevationM: number) => {
    const { minEle, maxEle } = extent();
    return PAD_TOP + PLOT_H - ((elevationM - minEle) / (maxEle - minEle)) * PLOT_H;
  };

  /**
   * Downsamples to roughly one sample per horizontal pixel. Beyond that the
   * extra points are invisible but still cost path-string size and parse time.
   */
  const drawn = createMemo<Sample[]>(() => {
    const list = samples();
    const budget = PLOT_W;
    if (list.length <= budget) return list;
    const step = list.length / budget;
    const out: Sample[] = [];
    for (let i = 0; i < budget; i++) {
      out.push(list[Math.floor(i * step)]);
    }
    out.push(list[list.length - 1]);
    return out;
  });

  const areaPath = createMemo(() => {
    const list = drawn();
    if (list.length === 0) return "";
    const top = list
      .map((s, i) => `${i === 0 ? "M" : "L"}${xOf(s.distanceM).toFixed(2)},${yOf(s.elevationM).toFixed(2)}`)
      .join("");
    const baseline = PAD_TOP + PLOT_H;
    return `${top}L${xOf(list[list.length - 1].distanceM).toFixed(2)},${baseline}L${xOf(list[0].distanceM).toFixed(2)},${baseline}Z`;
  });

  const linePath = createMemo(() => {
    const list = drawn();
    if (list.length === 0) return "";
    return list
      .map((s, i) => `${i === 0 ? "M" : "L"}${xOf(s.distanceM).toFixed(2)},${yOf(s.elevationM).toFixed(2)}`)
      .join("");
  });

  /** Four evenly spaced elevation gridlines. */
  const yTicks = createMemo(() => {
    const { minEle, maxEle } = extent();
    return Array.from({ length: 4 }, (_, i) => minEle + ((maxEle - minEle) * i) / 3);
  });

  const xTicks = createMemo(() => {
    const total = extent().totalM;
    return Array.from({ length: 5 }, (_, i) => (total * i) / 4);
  });

  /** Maps a client x-coordinate to the nearest sample by distance. */
  function sampleAt(clientX: number): Sample | null {
    const list = samples();
    if (list.length === 0) return null;

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;

    // Convert to viewBox units, then to a distance along the route.
    const viewX = ((clientX - rect.left) / rect.width) * VIEW_W;
    const ratio = (viewX - PAD_LEFT) / PLOT_W;
    const targetM = Math.max(0, Math.min(1, ratio)) * extent().totalM;

    // Binary search: the series is sorted by distance and can hold 6000 points
    // per track, so a linear scan on every pointermove would be wasteful.
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].distanceM < targetM) lo = mid + 1;
      else hi = mid;
    }
    const candidate = list[lo];
    const previous = list[lo - 1];
    if (previous && Math.abs(previous.distanceM - targetM) < Math.abs(candidate.distanceM - targetM)) {
      return previous;
    }
    return candidate;
  }

  function handleMove(event: PointerEvent) {
    const sample = sampleAt(event.clientX);
    if (!sample) return;
    props.setHovered({
      trackId: sample.trackId,
      index: sample.index,
      lon: sample.lon,
      lat: sample.lat,
      distanceM: sample.distanceM,
      elevationM: sample.elevationM,
      timeOffsetS: sample.timeOffsetS,
    });
  }

  const hoveredSample = createMemo(() => {
    const point = props.hovered();
    if (!point) return null;
    return { x: xOf(point.distanceM), y: yOf(point.elevationM ?? 0), point };
  });

  const hasData = createMemo(() => samples().length > 1);

  return (
    <Show
      when={hasData()}
      fallback={
        <p class="ink-muted px-4 py-6 text-sm">
          This route has no elevation data, so there is no profile to show.
        </p>
      }
    >
      <figure class="m-0">
        <svg
          ref={svg}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          class="block h-[180px] w-full sm:h-[220px]"
          role="img"
          aria-label="Elevation profile. Move the pointer across it to trace the route on the map."
          // touch-action:none is scoped to the plot so dragging here traces the
          // route instead of scrolling, while the rest of the page scrolls
          // normally.
          style={{ "touch-action": "none" }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            handleMove(event);
          }}
          onPointerMove={(event) => {
            // Only trace while a finger is down on touch; hover freely with a mouse.
            if (event.pointerType !== "touch" || event.pressure > 0) handleMove(event);
          }}
          onPointerUp={() => props.setHovered(null)}
          onPointerLeave={() => props.setHovered(null)}
        >
          <defs>
            <linearGradient id="elevation-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.32" />
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02" />
            </linearGradient>
          </defs>

          <For each={yTicks()}>
            {(elevation) => (
              <g>
                <line
                  x1={PAD_LEFT}
                  x2={VIEW_W - PAD_RIGHT}
                  y1={yOf(elevation)}
                  y2={yOf(elevation)}
                  stroke="var(--border-subtle)"
                  stroke-width="1"
                />
                <text
                  x={PAD_LEFT - 8}
                  y={yOf(elevation) + 4}
                  text-anchor="end"
                  fill="var(--ink-muted)"
                  style={{ "font-size": "11px" }}
                >
                  {Math.round(elevation).toLocaleString()}
                </text>
              </g>
            )}
          </For>

          <path d={areaPath()} fill="url(#elevation-fill)" />
          <path
            d={linePath()}
            fill="none"
            stroke="var(--accent)"
            stroke-width="2"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />

          <For each={xTicks()}>
            {(distance, i) => (
              <text
                x={xOf(distance)}
                y={VIEW_H - 8}
                text-anchor={i() === 0 ? "start" : i() === 4 ? "end" : "middle"}
                fill="var(--ink-muted)"
                style={{ "font-size": "11px" }}
              >
                {formatDistance(distance)}
              </text>
            )}
          </For>

          <Show when={hoveredSample()}>
            {(hover) => (
              <g>
                <line
                  x1={hover().x}
                  x2={hover().x}
                  y1={PAD_TOP}
                  y2={PAD_TOP + PLOT_H}
                  stroke="var(--accent)"
                  stroke-width="1.5"
                  vector-effect="non-scaling-stroke"
                />
                <circle
                  cx={hover().x}
                  cy={hover().y}
                  r="5"
                  fill="var(--surface)"
                  stroke="var(--accent)"
                  stroke-width="2.5"
                  vector-effect="non-scaling-stroke"
                />
              </g>
            )}
          </Show>
        </svg>

        {/* Readout below the chart rather than a floating tooltip: it never
            covers the line and never runs off the edge on a narrow screen. */}
        <figcaption class="tabular flex min-h-[2.25rem] flex-wrap items-center gap-x-5 gap-y-1 px-1 pt-1 text-sm">
          <Show
            when={props.hovered()}
            fallback={
              <span class="ink-muted text-xs">
                Drag across the profile to trace the route on the map.
              </span>
            }
          >
            {(point) => (
              <>
                <span>
                  <span class="ink-muted">at </span>
                  {formatDistance(point().distanceM)}
                </span>
                <Show when={point().elevationM != null}>
                  <span>
                    <span class="ink-muted">elev </span>
                    {formatElevation(point().elevationM as number)}
                  </span>
                </Show>
                <Show when={point().timeOffsetS != null}>
                  <span>
                    <span class="ink-muted">after </span>
                    {formatDuration(point().timeOffsetS as number)}
                  </span>
                </Show>
              </>
            )}
          </Show>
        </figcaption>
      </figure>
    </Show>
  );
}
