import { describe, expect, it } from "vitest";
import { computeArchiveStats, type RouteStage } from "./archive-stats";
import type { Route } from "./db/schema";

let nextId = 0;

function makeRoute(overrides: Partial<Route> = {}): Route {
  nextId += 1;
  return {
    id: `route-${nextId}`,
    slug: `route-${nextId}`,
    title: `Route ${nextId}`,
    description: null,
    visibility: "public",
    activityType: null,
    bbox: null,
    startedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    distanceM: 0,
    elevationGainM: 0,
    elevationLossM: 0,
    elevationMinM: null,
    elevationMaxM: null,
    durationS: null,
    movingTimeS: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    ...overrides,
  };
}

/** A single-track route's one stage mirrors the route's own aggregate stats. */
function soloStage(route: Route, overrides: Partial<RouteStage> = {}): RouteStage {
  return {
    routeId: route.id,
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    avgSpeedMps: route.avgSpeedMps,
    ...overrides,
  };
}

describe("computeArchiveStats", () => {
  it("sums distance and elevation across all routes", () => {
    const a = makeRoute({ distanceM: 10_000, elevationGainM: 200 });
    const b = makeRoute({ distanceM: 5_000, elevationGainM: 50 });
    const stats = computeArchiveStats([a, b], [soloStage(a), soloStage(b)]);

    expect(stats.routeCount).toBe(2);
    expect(stats.distanceM).toBe(15_000);
    expect(stats.elevationGainM).toBe(250);
  });

  it("prefers moving time over duration, and sums null as zero contribution", () => {
    const routes = [
      makeRoute({ movingTimeS: 3600, durationS: 4000 }),
      makeRoute({ durationS: 1800, movingTimeS: null }),
      makeRoute({ durationS: null, movingTimeS: null }),
    ];
    const stats = computeArchiveStats(routes, routes.map((r) => soloStage(r)));

    expect(stats.timeS).toBe(3600 + 1800);
  });

  it("reports null total time when no route recorded one", () => {
    const routes = [makeRoute(), makeRoute()];
    const stats = computeArchiveStats(routes, routes.map((r) => soloStage(r)));
    expect(stats.timeS).toBeNull();
  });

  it("groups by year, falling back to createdAt when startedAt is missing", () => {
    const routes = [
      makeRoute({ startedAt: new Date("2025-06-01T00:00:00Z"), distanceM: 1000 }),
      makeRoute({ startedAt: new Date("2026-03-01T00:00:00Z"), distanceM: 2000 }),
      makeRoute({ startedAt: null, createdAt: new Date("2026-07-01T00:00:00Z"), distanceM: 500 }),
    ];
    const stats = computeArchiveStats(routes, routes.map((r) => soloStage(r)));

    expect(stats.years.map((y) => y.year)).toEqual([2026, 2025]);
    const y2026 = stats.years.find((y) => y.year === 2026);
    expect(y2026?.routeCount).toBe(2);
    expect(y2026?.distanceM).toBe(2500);
  });

  it("picks the highest-value single-track route for each record, ignoring nulls", () => {
    const short = makeRoute({ title: "Short", slug: "short", distanceM: 1000, elevationGainM: 10 });
    const long = makeRoute({ title: "Long", slug: "long", distanceM: 9000, elevationGainM: 500 });
    const fast = makeRoute({ title: "Fast", slug: "fast", avgSpeedMps: 8, distanceM: 500 });
    const noSpeed = makeRoute({ title: "No speed", slug: "no-speed", avgSpeedMps: null });
    const routes = [short, long, fast, noSpeed];

    const stats = computeArchiveStats(routes, routes.map((r) => soloStage(r)));

    expect(stats.longestRoute).toEqual({ title: "Long", slug: "long", value: 9000 });
    expect(stats.biggestClimb).toEqual({ title: "Long", slug: "long", value: 500 });
    expect(stats.fastestAvg).toEqual({ title: "Fast", slug: "fast", value: 8 });
  });

  it("scores records per stage, not per route, so a multi-day trip's combined total doesn't win", () => {
    // A 3-day trek: 40km combined, but no single day tops the 15km solo ride.
    const trek = makeRoute({ title: "Trek", slug: "trek", distanceM: 40_000, elevationGainM: 3000 });
    const soloRide = makeRoute({ title: "Solo ride", slug: "solo-ride", distanceM: 15_000, elevationGainM: 100 });
    const routes = [trek, soloRide];

    const stages: RouteStage[] = [
      { routeId: trek.id, distanceM: 12_000, elevationGainM: 900, avgSpeedMps: 1.2 },
      { routeId: trek.id, distanceM: 14_000, elevationGainM: 1100, avgSpeedMps: 1.3 },
      { routeId: trek.id, distanceM: 14_000, elevationGainM: 1000, avgSpeedMps: 1.1 },
      soloStage(soloRide, { avgSpeedMps: 6 }),
    ];

    const stats = computeArchiveStats(routes, stages);

    // Totals still reflect the whole trip.
    expect(stats.distanceM).toBe(55_000);
    expect(stats.elevationGainM).toBe(3100);

    // But records are won by the best single day.
    expect(stats.longestRoute).toEqual({ title: "Solo ride", slug: "solo-ride", value: 15_000 });
    expect(stats.biggestClimb).toEqual({ title: "Trek", slug: "trek", value: 1100 });
    expect(stats.fastestAvg).toEqual({ title: "Solo ride", slug: "solo-ride", value: 6 });
  });

  it("returns nulls and an empty year list for an empty archive", () => {
    const stats = computeArchiveStats([], []);
    expect(stats.routeCount).toBe(0);
    expect(stats.years).toEqual([]);
    expect(stats.longestRoute).toBeNull();
    expect(stats.biggestClimb).toBeNull();
    expect(stats.fastestAvg).toBeNull();
    expect(stats.timeS).toBeNull();
  });
});
