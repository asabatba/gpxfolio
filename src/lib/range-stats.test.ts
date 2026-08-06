import { describe, expect, it } from "vitest";
import { computeRangeStats } from "./range-stats";
import type { TrackView } from "./track-view";

function track(overrides: Partial<TrackView> = {}): TrackView {
  return {
    id: "t1",
    name: null,
    color: "#e5007d",
    coordinates: [
      [1.5, 42.5],
      [1.51, 42.51],
      [1.52, 42.52],
      [1.53, 42.53],
      [1.54, 42.54],
    ],
    distances: [0, 100, 250, 400, 600],
    elevations: [1000, 1010, 1005, 1030, 1020],
    timeOffsets: [0, 60, 130, 210, 300],
    distanceM: 600,
    elevationGainM: 45,
    startedAt: null,
    ...overrides,
  };
}

describe("computeRangeStats", () => {
  it("computes distance as the difference of cumulative distances at the two indices", () => {
    const stats = computeRangeStats(track(), { trackId: "t1", startIndex: 1, endIndex: 3 });
    expect(stats.distanceM).toBe(300); // 400 - 100
  });

  it("sums only the positive deltas as gain and only the negative ones (inverted) as loss", () => {
    // Over the full track: 1000->1010 (+10), 1010->1005 (-5), 1005->1030 (+25), 1030->1020 (-10)
    const stats = computeRangeStats(track(), { trackId: "t1", startIndex: 0, endIndex: 4 });
    expect(stats.elevationGainM).toBe(35); // 10 + 25
    expect(stats.elevationLossM).toBe(15); // 5 + 10
  });

  it("computes elapsed time as the difference of time offsets at the two indices", () => {
    const stats = computeRangeStats(track(), { trackId: "t1", startIndex: 1, endIndex: 3 });
    expect(stats.elapsedS).toBe(150); // 210 - 60
  });

  it("derives average speed from distance and elapsed time", () => {
    const stats = computeRangeStats(track(), { trackId: "t1", startIndex: 0, endIndex: 1 });
    expect(stats.avgSpeedMps).toBeCloseTo(100 / 60, 5);
  });

  it("returns null elapsed time and average speed when the track has no time data", () => {
    const stats = computeRangeStats(track({ timeOffsets: null }), {
      trackId: "t1",
      startIndex: 0,
      endIndex: 2,
    });
    expect(stats.elapsedS).toBeNull();
    expect(stats.avgSpeedMps).toBeNull();
  });

  it("returns zero gain/loss when the track has no elevation data", () => {
    const stats = computeRangeStats(track({ elevations: null }), {
      trackId: "t1",
      startIndex: 0,
      endIndex: 4,
    });
    expect(stats.elevationGainM).toBe(0);
    expect(stats.elevationLossM).toBe(0);
  });

  it("returns zeroed stats for a zero-length range (start === end)", () => {
    const stats = computeRangeStats(track(), { trackId: "t1", startIndex: 2, endIndex: 2 });
    expect(stats.distanceM).toBe(0);
    expect(stats.elevationGainM).toBe(0);
    expect(stats.elevationLossM).toBe(0);
    expect(stats.elapsedS).toBe(0);
    expect(stats.avgSpeedMps).toBeNull(); // Nothing to divide by — zero elapsed time.
  });
});
