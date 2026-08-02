import { describe, expect, it } from "vitest";
import { computeArchiveStats } from "./archive-stats";
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

describe("computeArchiveStats", () => {
  it("sums distance and elevation across all routes", () => {
    const stats = computeArchiveStats([
      makeRoute({ distanceM: 10_000, elevationGainM: 200 }),
      makeRoute({ distanceM: 5_000, elevationGainM: 50 }),
    ]);

    expect(stats.routeCount).toBe(2);
    expect(stats.distanceM).toBe(15_000);
    expect(stats.elevationGainM).toBe(250);
  });

  it("prefers moving time over duration, and sums null as zero contribution", () => {
    const stats = computeArchiveStats([
      makeRoute({ movingTimeS: 3600, durationS: 4000 }),
      makeRoute({ durationS: 1800, movingTimeS: null }),
      makeRoute({ durationS: null, movingTimeS: null }),
    ]);

    expect(stats.timeS).toBe(3600 + 1800);
  });

  it("reports null total time when no route recorded one", () => {
    const stats = computeArchiveStats([makeRoute(), makeRoute()]);
    expect(stats.timeS).toBeNull();
  });

  it("groups by year, falling back to createdAt when startedAt is missing", () => {
    const stats = computeArchiveStats([
      makeRoute({ startedAt: new Date("2025-06-01T00:00:00Z"), distanceM: 1000 }),
      makeRoute({ startedAt: new Date("2026-03-01T00:00:00Z"), distanceM: 2000 }),
      makeRoute({ startedAt: null, createdAt: new Date("2026-07-01T00:00:00Z"), distanceM: 500 }),
    ]);

    expect(stats.years.map((y) => y.year)).toEqual([2026, 2025]);
    const y2026 = stats.years.find((y) => y.year === 2026);
    expect(y2026?.routeCount).toBe(2);
    expect(y2026?.distanceM).toBe(2500);
  });

  it("picks the highest-value route for each record, ignoring nulls", () => {
    const short = makeRoute({ title: "Short", slug: "short", distanceM: 1000, elevationGainM: 10 });
    const long = makeRoute({ title: "Long", slug: "long", distanceM: 9000, elevationGainM: 500 });
    const fast = makeRoute({ title: "Fast", slug: "fast", avgSpeedMps: 8, distanceM: 500 });
    const noSpeed = makeRoute({ title: "No speed", slug: "no-speed", avgSpeedMps: null });

    const stats = computeArchiveStats([short, long, fast, noSpeed]);

    expect(stats.longestRoute).toEqual({ title: "Long", slug: "long", value: 9000 });
    expect(stats.biggestClimb).toEqual({ title: "Long", slug: "long", value: 500 });
    expect(stats.fastestAvg).toEqual({ title: "Fast", slug: "fast", value: 8 });
  });

  it("returns nulls and an empty year list for an empty archive", () => {
    const stats = computeArchiveStats([]);
    expect(stats.routeCount).toBe(0);
    expect(stats.years).toEqual([]);
    expect(stats.longestRoute).toBeNull();
    expect(stats.biggestClimb).toBeNull();
    expect(stats.fastestAvg).toBeNull();
    expect(stats.timeS).toBeNull();
  });
});
