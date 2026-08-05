import { createMemo, For, Show, type Setter } from "solid-js";
import { formatDistance, formatDuration, formatElevation, formatTimeInZone } from "~/lib/format";
import type { Schedule } from "~/lib/planning";
import type { HoverPoint, TrackView } from "~/lib/track-view";

interface ElevationProfileProps {
  tracks: TrackView[];
  hovered: () => HoverPoint | null;
  setHovered: Setter<HoverPoint | null>;
  /** Set while `RoutePlanner`'s panel is open, to add an arrival-time readout at the hovered point. */
  plan?: () => { schedule: Schedule; timeZone: string } | null;
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

/** Beyond this, the line is fully saturated — a typical "very steep" grade for hiking/gravel. */
const MAX_GRADE_PCT = 18;

/**
 * Diverging colour for one segment's steepness: `--grade-climb` /
 * `--grade-descent` at the poles, blending toward the neutral
 * `--ink-muted` as a segment flattens out — see `app.css` for why this
 * particular pair was chosen (validated against both colour schemes with the
 * dataviz skill's palette checker).
 */
function gradeColor(gradePct: number): string {
  const t = Math.max(-1, Math.min(1, gradePct / MAX_GRADE_PCT));
  const pole = t >= 0 ? "var(--grade-climb)" : "var(--grade-descent)";
  return `color-mix(in oklab, ${pole} ${Math.round(Math.abs(t) * 100)}%, var(--ink-muted))`;
}

/** "+8%" / "-12%" / "flat", for the hover readout. */
function formatGrade(gradePct: number): string {
  const rounded = Math.round(gradePct);
  if (rounded === 0) return "flat";
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

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

  interface GradeSegment {
    d: string;
    color: string;
    toM: number;
    gradePct: number;
  }

  /**
   * One `<path>` per drawn segment rather than a single multi-point path, so
   * each can carry its own steepness colour — same downsample budget as the
   * line it replaces, so this is no more SVG than before.
   */
  const gradeSegments = createMemo<GradeSegment[]>(() => {
    const list = drawn();
    const segments: GradeSegment[] = [];
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      const dx = curr.distanceM - prev.distanceM;
      const gradePct = dx > 1 ? ((curr.elevationM - prev.elevationM) / dx) * 100 : 0;
      segments.push({
        d: `M${xOf(prev.distanceM).toFixed(2)},${yOf(prev.elevationM).toFixed(2)}L${xOf(curr.distanceM).toFixed(2)},${yOf(curr.elevationM).toFixed(2)}`,
        color: gradeColor(gradePct),
        toM: curr.distanceM,
        gradePct,
      });
    }
    return segments;
  });

  /** The grade shown alongside distance/elevation in the hover readout — the same value its segment is coloured by. */
  function gradePercentAt(distanceM: number): number | null {
    const segments = gradeSegments();
    if (segments.length === 0) return null;
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].toM < distanceM) lo = mid + 1;
      else hi = mid;
    }
    return segments[lo].gradePct;
  }

  /** Four evenly spaced elevation gridlines. */
  const yTicks = createMemo(() => {
    const { minEle, maxEle } = extent();
    return Array.from({ length: 4 }, (_, i) => minEle + ((maxEle - minEle) * i) / 3);
  });

  const xTicks = createMemo(() => {
    const total = extent().totalM;
    return Array.from({ length: 5 }, (_, i) => (total * i) / 4);
  });

  /** Nearest sample to a distance along the route — shared by pointer and keyboard input. */
  function sampleAtDistance(targetM: number): Sample | null {
    const list = samples();
    if (list.length === 0) return null;

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

  /** Maps a client x-coordinate to the nearest sample by distance. */
  function sampleAt(clientX: number): Sample | null {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;

    // Convert to viewBox units, then to a distance along the route.
    const viewX = ((clientX - rect.left) / rect.width) * VIEW_W;
    const ratio = (viewX - PAD_LEFT) / PLOT_W;
    const targetM = Math.max(0, Math.min(1, ratio)) * extent().totalM;
    return sampleAtDistance(targetM);
  }

  function setHoveredSample(sample: Sample | null) {
    if (!sample) {
      props.setHovered(null);
      return;
    }
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

  function handleMove(event: PointerEvent) {
    setHoveredSample(sampleAt(event.clientX));
  }

  // Arrow keys step by 1% of the route's total distance — fine enough to feel
  // continuous, coarse enough to cross a long route in a reasonable number of
  // presses. Home/End jump to the very start/finish.
  function handleKeyDown(event: KeyboardEvent) {
    const list = samples();
    if (list.length === 0) return;

    const totalM = extent().totalM;
    const step = totalM / 100;
    const current = props.hovered()?.distanceM ?? 0;

    let targetM: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      targetM = Math.min(totalM, current + step);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      targetM = Math.max(0, current - step);
    } else if (event.key === "Home") {
      targetM = 0;
    } else if (event.key === "End") {
      targetM = totalM;
    } else {
      return;
    }

    event.preventDefault();
    setHoveredSample(sampleAtDistance(targetM));
  }

  const hoveredSample = createMemo(() => {
    const point = props.hovered();
    if (!point) return null;
    return { x: xOf(point.distanceM), y: yOf(point.elevationM ?? 0), point };
  });

  const hasData = createMemo(() => samples().length > 1);

  /**
   * `role="slider"` rather than `role="img"`: the profile is a 1-D position
   * picker along the route (arrow keys move it, a value gets announced),
   * which is exactly what the slider pattern is for — and `aria-valuetext`
   * lets that announcement carry both distance and elevation, not just a
   * bare number.
   */
  /** Estimated arrival time at a distance under the active plan, in the trailhead's own timezone. */
  const arrivalTextAt = (distanceM: number): string | null => {
    const plan = props.plan?.();
    if (!plan) return null;
    return formatTimeInZone(plan.schedule.arrivalAt(distanceM), plan.timeZone);
  };

  const valueText = createMemo(() => {
    const point = props.hovered();
    const distanceM = point?.distanceM ?? 0;
    const parts = [`at ${formatDistance(distanceM)}`];
    const elevationM = point?.elevationM ?? sampleAtDistance(distanceM)?.elevationM;
    if (elevationM != null) parts.push(`elevation ${formatElevation(elevationM)}`);
    const gradePct = gradePercentAt(distanceM);
    if (gradePct != null) parts.push(`grade ${formatGrade(gradePct)}`);
    const arrival = arrivalTextAt(distanceM);
    if (arrival != null) parts.push(`arriving ${arrival}`);
    return parts.join(", ");
  });

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
        {/* The interactive/ARIA surface lives on this div, not the `<svg>` it
            wraps: `<svg>` has no native interactive semantics, so an a11y
            linter correctly rejects an interactive role placed on it
            directly (`role="slider"` here — the profile is a 1-D position
            picker along the route, which the slider pattern models exactly,
            with `aria-valuetext` carrying both distance and elevation). */}
        <div
          tabIndex={hasData() ? 0 : undefined}
          role="slider"
          class="block h-[180px] w-full cursor-pointer sm:h-[220px]"
          aria-label="Elevation profile. Point, drag, or use the arrow keys to trace the route on the map."
          aria-valuemin={0}
          aria-valuemax={Math.round(extent().totalM)}
          aria-valuenow={Math.round(props.hovered()?.distanceM ?? 0)}
          aria-valuetext={valueText()}
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
          onKeyDown={handleKeyDown}
          onBlur={() => props.setHovered(null)}
        >
        <svg
          ref={svg}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          class="block h-full w-full"
          aria-hidden="true"
        >
          <defs>
            {/* Neutral now that the line itself carries colour (grade) — an
                accent-tinted wash would visually compete with a climb-coloured
                line above it. */}
            <linearGradient id="elevation-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--ink-muted)" stop-opacity="0.28" />
              <stop offset="100%" stop-color="var(--ink-muted)" stop-opacity="0.02" />
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
          <For each={gradeSegments()}>
            {(segment) => (
              <path
                d={segment.d}
                fill="none"
                stroke={segment.color}
                stroke-width="2"
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
              />
            )}
          </For>

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
        </div>

        {/* Readout below the chart rather than a floating tooltip: it never
            covers the line and never runs off the edge on a narrow screen. */}
        <figcaption class="tabular flex min-h-[2.25rem] flex-wrap items-center gap-x-5 gap-y-1 px-1 pt-1 text-sm">
          <Show
            when={props.hovered()}
            fallback={
              <span class="ink-muted text-xs">
                Point, drag, or use the arrow keys to trace the route on the map.
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
                {/* `when={... != null}`, not the raw percentage — a flat 0%
                    grade is falsy and would otherwise hide its own readout. */}
                <Show when={gradePercentAt(point().distanceM) != null}>
                  <span>
                    <span class="ink-muted">grade </span>
                    {formatGrade(gradePercentAt(point().distanceM) as number)}
                  </span>
                </Show>
                <Show when={point().timeOffsetS != null}>
                  <span>
                    <span class="ink-muted">after </span>
                    {formatDuration(point().timeOffsetS as number)}
                  </span>
                </Show>
                <Show when={arrivalTextAt(point().distanceM)}>
                  {(arrival) => (
                    <span>
                      <span class="ink-muted">arriving </span>
                      {arrival()}
                    </span>
                  )}
                </Show>
              </>
            )}
          </Show>

          {/* Decorative: the line's own colour already carries this, and the
              hover readout above states the exact grade in text — this is
              purely an at-a-glance key to what the colour means. */}
          <span class="ml-auto flex items-center gap-1.5 text-xs" aria-hidden="true">
            <span class="ink-muted">Descent</span>
            <span
              class="h-1.5 w-12 rounded-full"
              style={{
                background:
                  "linear-gradient(to right, var(--grade-descent), var(--ink-muted), var(--grade-climb))",
              }}
            />
            <span class="ink-muted">Climb</span>
          </span>
        </figcaption>
      </figure>
    </Show>
  );
}
