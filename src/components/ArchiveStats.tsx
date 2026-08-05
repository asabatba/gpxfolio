import { A } from "@solidjs/router";
import { clientOnly } from "@solidjs/start";
import { For, Show } from "solid-js";
import MapSkeleton from "~/components/MapSkeleton";
import YearlyBarChart, { type YearBar } from "~/components/YearlyBarChart";
import type { ArchiveStats as ArchiveStatsData, YearlyStats } from "~/lib/archive-stats";
import { formatDistance, formatDuration, formatElevation, formatSpeed } from "~/lib/format";

const ArchiveMap = clientOnly(() => import("~/components/ArchiveMap"));

// Shared with the skeleton fallback so it occupies exactly the same box as the
// real map — no layout shift once the client chunk loads.
const MAP_CLASS = "card h-64 w-full overflow-hidden rounded-xl sm:h-80";

interface ArchiveStatsProps {
  stats: ArchiveStatsData;
  /** Encoded polylines from every public route's tracks, for the overview map. */
  trackGeometries: string[];
}

interface Tile {
  label: string;
  value: string;
}

function totalsTiles(stats: ArchiveStatsData): Tile[] {
  const tiles: Tile[] = [
    { label: "Routes", value: stats.routeCount.toLocaleString() },
    { label: "Distance", value: formatDistance(stats.distanceM) },
    { label: "Elevation gain", value: formatElevation(stats.elevationGainM) },
  ];
  if (stats.timeS != null) {
    tiles.push({ label: "Time", value: formatDuration(stats.timeS) });
  }
  return tiles;
}

interface RecordRow {
  label: string;
  slug: string;
  title: string;
  value: string;
}

function records(stats: ArchiveStatsData): RecordRow[] {
  const rows: RecordRow[] = [];
  if (stats.longestRoute) {
    rows.push({
      label: "Longest route",
      slug: stats.longestRoute.slug,
      title: stats.longestRoute.title,
      value: formatDistance(stats.longestRoute.value),
    });
  }
  if (stats.biggestClimb) {
    rows.push({
      label: "Biggest climb",
      slug: stats.biggestClimb.slug,
      title: stats.biggestClimb.title,
      value: formatElevation(stats.biggestClimb.value),
    });
  }
  if (stats.fastestAvg) {
    rows.push({
      label: "Fastest average",
      slug: stats.fastestAvg.slug,
      title: stats.fastestAvg.title,
      value: formatSpeed(stats.fastestAvg.value),
    });
  }
  return rows;
}

/** Oldest first — the table this replaces was newest-first, but a trend reads left-to-right as "then to now." */
function chronological(years: YearlyStats[]): YearlyStats[] {
  return [...years].sort((a, b) => a.year - b.year);
}

function distanceBars(years: YearlyStats[]): YearBar[] {
  return chronological(years).map((y) => ({
    year: y.year,
    value: y.distanceM,
    tooltip: `${y.year}: ${formatDistance(y.distanceM)}`,
  }));
}

function elevationBars(years: YearlyStats[]): YearBar[] {
  return chronological(years).map((y) => ({
    year: y.year,
    value: y.elevationGainM,
    tooltip: `${y.year}: ${formatElevation(y.elevationGainM)}`,
  }));
}

function timeBars(years: YearlyStats[]): YearBar[] {
  return chronological(years).map((y) => ({
    year: y.year,
    value: y.timeS ?? 0,
    tooltip: `${y.year}: ${y.timeS != null ? formatDuration(y.timeS) : "no time recorded"}`,
  }));
}

export default function ArchiveStats(props: ArchiveStatsProps) {
  return (
    <Show when={props.stats.routeCount > 0}>
      <section class="py-8 sm:py-10">
        <dl class="tabular grid grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-4">
          <For each={totalsTiles(props.stats)}>
            {(tile) => (
              <div
                class="surface-raised px-3 py-3 sm:px-4 sm:py-4"
                style={{ "background-color": "var(--border-subtle)" }}
              >
                <dt class="ink-muted text-[0.6875rem] font-semibold uppercase tracking-wider">
                  {tile.label}
                </dt>
                <dd class="mt-1 text-xl font-semibold sm:text-2xl">{tile.value}</dd>
              </div>
            )}
          </For>
        </dl>

        <Show when={records(props.stats).length > 0}>
          <ul class="tabular mt-4 grid gap-2 sm:grid-cols-3">
            <For each={records(props.stats)}>
              {(row) => (
                <li>
                  <A
                    href={`/r/${row.slug}`}
                    class="card flex items-center justify-between gap-3 rounded-xl px-4 py-3 transition-transform hover:-translate-y-0.5"
                  >
                    <span>
                      <span class="ink-muted block text-[0.6875rem] font-semibold uppercase tracking-wider">
                        {row.label}
                      </span>
                      <span class="mt-0.5 block truncate text-sm font-medium">{row.title}</span>
                    </span>
                    <span class="shrink-0 font-semibold">{row.value}</span>
                  </A>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={props.stats.years.length > 0}>
          <div class="mt-4 grid gap-2 sm:grid-cols-3">
            <YearlyBarChart title="Distance" bars={distanceBars(props.stats.years)} />
            <YearlyBarChart title="Elevation gain" bars={elevationBars(props.stats.years)} />
            <YearlyBarChart title="Time" bars={timeBars(props.stats.years)} />
          </div>
        </Show>

        <Show when={props.trackGeometries.length > 0}>
          <div class="mt-4">
            <p class="ink-muted text-[0.6875rem] font-semibold uppercase tracking-wider">
              Everywhere I've been
            </p>
            <ArchiveMap
              tracks={props.trackGeometries}
              class={`mt-2 ${MAP_CLASS}`}
              fallback={<MapSkeleton class={`mt-2 ${MAP_CLASS}`} />}
            />
          </div>
        </Show>
      </section>
    </Show>
  );
}
