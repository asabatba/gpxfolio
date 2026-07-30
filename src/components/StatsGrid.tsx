import { For, Show } from "solid-js";
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatPace,
  formatSpeed,
  type UnitSystem,
} from "~/lib/format";
import type { RouteStats } from "~/lib/gpx/types";

interface StatsGridProps {
  stats: RouteStats;
  units: UnitSystem;
  /** Running and hiking read better as pace; riding as speed. */
  activityType?: string | null;
  class?: string;
}

const PACE_ACTIVITIES = ["run", "running", "hike", "hiking", "walk", "walking", "trail"];

function prefersPace(activityType: string | null | undefined): boolean {
  if (!activityType) return false;
  return PACE_ACTIVITIES.includes(activityType.trim().toLowerCase());
}

interface Tile {
  label: string;
  value: string;
  /** Emphasised tiles lead the grid. */
  primary?: boolean;
}

function buildTiles(props: StatsGridProps): Tile[] {
  const { stats, units } = props;
  const tiles: Tile[] = [
    { label: "Distance", value: formatDistance(stats.distanceM, units), primary: true },
    { label: "Ascent", value: formatElevation(stats.elevationGainM, units), primary: true },
  ];

  if (stats.movingTimeS != null) {
    tiles.push({
      label: "Moving time",
      value: formatDuration(stats.movingTimeS),
      primary: true,
    });
  } else if (stats.durationS != null) {
    tiles.push({ label: "Duration", value: formatDuration(stats.durationS), primary: true });
  }

  tiles.push({ label: "Descent", value: formatElevation(stats.elevationLossM, units) });

  if (stats.elevationMaxM != null) {
    tiles.push({ label: "Max elevation", value: formatElevation(stats.elevationMaxM, units) });
  }

  if (stats.avgSpeedMps != null) {
    tiles.push(
      prefersPace(props.activityType)
        ? { label: "Avg pace", value: formatPace(stats.avgSpeedMps, units) }
        : { label: "Avg speed", value: formatSpeed(stats.avgSpeedMps, units) },
    );
  }

  if (stats.maxSpeedMps != null && !prefersPace(props.activityType)) {
    tiles.push({ label: "Max speed", value: formatSpeed(stats.maxSpeedMps, units) });
  }

  // Only worth showing when it differs from moving time.
  if (
    stats.durationS != null &&
    stats.movingTimeS != null &&
    stats.durationS - stats.movingTimeS > 60
  ) {
    tiles.push({ label: "Elapsed", value: formatDuration(stats.durationS) });
  }

  return tiles;
}

export default function StatsGrid(props: StatsGridProps) {
  const tiles = () => buildTiles(props);

  return (
    <dl
      class={`tabular grid grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-3 lg:grid-cols-4 ${props.class ?? ""}`}
      style={{ "background-color": "var(--border-subtle)" }}
    >
      <For each={tiles()}>
        {(tile) => (
          <div class="surface-raised px-3 py-3 sm:px-4 sm:py-4">
            <dt class="ink-muted text-[0.6875rem] font-semibold uppercase tracking-wider">
              {tile.label}
            </dt>
            <dd
              class="mt-1 font-semibold"
              classList={{
                "text-xl sm:text-2xl": tile.primary,
                "text-lg sm:text-xl": !tile.primary,
              }}
            >
              {tile.value}
            </dd>
          </div>
        )}
      </For>
      <Show when={tiles().length === 0}>
        <div class="surface-raised ink-muted px-4 py-4 text-sm">No statistics available.</div>
      </Show>
    </dl>
  );
}
