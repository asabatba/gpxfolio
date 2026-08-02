import type { Route } from "./db/schema";

/** One route's contribution to a leaderboard: enough to link back to it. */
export interface RouteRecord {
  title: string;
  slug: string;
  value: number;
}

export interface YearlyStats {
  year: number;
  routeCount: number;
  distanceM: number;
  elevationGainM: number;
  /** Null when none of the year's routes recorded a time. */
  timeS: number | null;
}

export interface ArchiveStats {
  routeCount: number;
  distanceM: number;
  elevationGainM: number;
  timeS: number | null;
  /** Newest year first. */
  years: YearlyStats[];
  longestRoute: RouteRecord | null;
  biggestClimb: RouteRecord | null;
  /** Value is avgSpeedMps; only routes that recorded a speed are eligible. */
  fastestAvg: RouteRecord | null;
}

/** Moving time reads better than wall-clock duration when both exist. */
function routeTimeS(route: Route): number | null {
  return route.movingTimeS ?? route.durationS ?? null;
}

/** Falls back to upload time for routes with no recorded start (e.g. time-less GPX). */
function routeYear(route: Route): number {
  return (route.startedAt ?? route.createdAt).getFullYear();
}

function keepHighest(
  current: RouteRecord | null,
  route: Route,
  value: number | null,
): RouteRecord | null {
  if (value == null) return current;
  if (current && value <= current.value) return current;
  return { title: route.title, slug: route.slug, value };
}

/**
 * Aggregates a flat list of routes into the totals/per-year/records shown on
 * the homepage stats section. Pure and in-memory — cheap enough at any size
 * this personal archive is likely to reach, and it keeps the query in
 * `routes.server.ts` a single `listPublicRoutes()` call.
 */
export function computeArchiveStats(routes: Route[]): ArchiveStats {
  const years = new Map<number, YearlyStats>();

  let distanceM = 0;
  let elevationGainM = 0;
  let timeS = 0;
  let hasTime = false;
  let longestRoute: RouteRecord | null = null;
  let biggestClimb: RouteRecord | null = null;
  let fastestAvg: RouteRecord | null = null;

  for (const route of routes) {
    distanceM += route.distanceM;
    elevationGainM += route.elevationGainM;

    const t = routeTimeS(route);
    if (t != null) {
      timeS += t;
      hasTime = true;
    }

    const year = routeYear(route);
    const bucket = years.get(year) ?? {
      year,
      routeCount: 0,
      distanceM: 0,
      elevationGainM: 0,
      timeS: null,
    };
    bucket.routeCount += 1;
    bucket.distanceM += route.distanceM;
    bucket.elevationGainM += route.elevationGainM;
    if (t != null) bucket.timeS = (bucket.timeS ?? 0) + t;
    years.set(year, bucket);

    longestRoute = keepHighest(longestRoute, route, route.distanceM);
    biggestClimb = keepHighest(biggestClimb, route, route.elevationGainM);
    fastestAvg = keepHighest(fastestAvg, route, route.avgSpeedMps);
  }

  return {
    routeCount: routes.length,
    distanceM,
    elevationGainM,
    timeS: hasTime ? timeS : null,
    years: [...years.values()].sort((a, b) => b.year - a.year),
    longestRoute,
    biggestClimb,
    fastestAvg,
  };
}
