import { For } from "solid-js";

/**
 * Hand-rolled SVG, no charting library — same rationale as
 * `ElevationProfile.tsx`: this is a handful of static bars, nothing that
 * needs a library's worth of interaction logic. Oldest year first (left to
 * right), the opposite of the yearly table's newest-first order this
 * replaces — a trend reads left-to-right as "then to now."
 */

const VIEW_W = 300;
const VIEW_H = 120;
const PAD_TOP = 8;
const PAD_BOTTOM = 20;
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;
const BAR_WIDTH_FRACTION = 0.7; // Leaves gaps between bars proportional to their slot.

export interface YearBar {
  year: number;
  /** Bar height source; 0 renders as a bare tick, never a missing bar. */
  value: number;
  /** Full text for the native tooltip, e.g. "2024: 312 km" or "2023: no time recorded". */
  tooltip: string;
}

export default function YearlyBarChart(props: { title: string; bars: YearBar[] }) {
  const max = () => Math.max(1, ...props.bars.map((bar) => bar.value));
  const slotWidth = () => VIEW_W / props.bars.length;

  return (
    <div class="card rounded-xl px-3 py-3">
      <h3 class="ink-muted mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider">
        {props.title}
      </h3>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        class="w-full"
        role="img"
        aria-label={`${props.title} by year: ${props.bars.map((b) => b.tooltip).join(", ")}`}
      >
        <For each={props.bars}>
          {(bar, i) => {
            const height = Math.max((bar.value / max()) * PLOT_H, 2);
            const slotX = i() * slotWidth();
            const barX = slotX + (slotWidth() * (1 - BAR_WIDTH_FRACTION)) / 2;
            const barWidth = slotWidth() * BAR_WIDTH_FRACTION;
            return (
              <g>
                <rect
                  x={barX}
                  y={PAD_TOP + PLOT_H - height}
                  width={barWidth}
                  height={height}
                  rx="2"
                  fill="var(--accent)"
                >
                  <title>{bar.tooltip}</title>
                </rect>
                <text
                  x={slotX + slotWidth() / 2}
                  y={VIEW_H - 4}
                  text-anchor="middle"
                  font-size="9"
                  fill="var(--ink-muted)"
                >
                  {bar.year}
                </text>
              </g>
            );
          }}
        </For>
      </svg>
    </div>
  );
}
