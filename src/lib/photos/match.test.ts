import { describe, expect, it } from "vitest";
import {
  nearestSpatialPoint,
  nearestTimeIndex,
  routeTimeRange,
  selectTrackForCapture,
  type TimedTrack,
} from "./match";

describe("routeTimeRange", () => {
  it("returns null when no track has time data", () => {
    const tracks: TimedTrack[] = [{ id: "a", startedAt: null, timeOffsets: null, distances: [] }];
    expect(routeTimeRange(tracks)).toBeNull();
  });

  it("unions the span across several timed tracks", () => {
    const tracks: TimedTrack[] = [
      { id: "a", startedAt: 1000, timeOffsets: [0, 60], distances: [0, 100] },
      { id: "b", startedAt: 5000, timeOffsets: [0, 30], distances: [0, 50] },
      { id: "c", startedAt: null, timeOffsets: null, distances: [] },
    ];
    expect(routeTimeRange(tracks)).toEqual({ startMs: 1000, endMs: 1000 + 60 * 1000 });
  });
});

describe("nearestTimeIndex", () => {
  const offsets = [0, 10, 20, 30, 40];

  it("finds an exact hit", () => {
    expect(nearestTimeIndex(offsets, 20)).toBe(2);
  });

  it("picks the closer of two straddling points", () => {
    expect(nearestTimeIndex(offsets, 24)).toBe(2);
    expect(nearestTimeIndex(offsets, 26)).toBe(3);
  });

  it("clamps below the first and above the last", () => {
    expect(nearestTimeIndex(offsets, -100)).toBe(0);
    expect(nearestTimeIndex(offsets, 1000)).toBe(4);
  });
});

describe("selectTrackForCapture", () => {
  const trackA: TimedTrack = {
    id: "a",
    startedAt: 0,
    timeOffsets: [0, 60, 120], // spans 0..120s
    distances: [0, 500, 1000],
  };
  const trackB: TimedTrack = {
    id: "b",
    startedAt: 300_000, // 300s, well after track A ends
    timeOffsets: [0, 60],
    distances: [0, 400],
  };

  it("matches an instant inside a track's own span", () => {
    const result = selectTrackForCapture([trackA, trackB], 60_000, 60_000);
    expect(result).toEqual({ trackId: "a", index: 1 });
  });

  it("in a gap between tracks, picks whichever is nearer, within tolerance", () => {
    // 200_000ms: 80s after track A ends (120_000), 100s before track B starts.
    const result = selectTrackForCapture([trackA, trackB], 200_000, 90_000);
    expect(result?.trackId).toBe("a");
  });

  it("returns null when even the closest track exceeds tolerance", () => {
    const result = selectTrackForCapture([trackA, trackB], 200_000, 30_000);
    expect(result).toBeNull();
  });

  it("returns null when no track has time data at all", () => {
    const untimed: TimedTrack = { id: "c", startedAt: null, timeOffsets: null, distances: [] };
    expect(selectTrackForCapture([untimed], 0, 60_000)).toBeNull();
  });
});

describe("nearestSpatialPoint", () => {
  // Roughly a short line running east along the equator.
  const coordinates: Array<[number, number]> = [
    [0, 0],
    [0, 0.01],
    [0, 0.02],
  ];

  it("finds an exact vertex", () => {
    const result = nearestSpatialPoint(coordinates, 0, 0.01);
    expect(result?.index).toBe(1);
    expect(result?.distanceM).toBeCloseTo(0, 0);
  });

  it("finds the nearest point when off the line", () => {
    const result = nearestSpatialPoint(coordinates, 0.001, 0.02);
    expect(result?.index).toBe(2);
  });

  it("returns null for an empty coordinate list", () => {
    expect(nearestSpatialPoint([], 0, 0)).toBeNull();
  });
});
