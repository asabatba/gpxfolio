import { describe, expect, it } from "vitest";
import { haversineM } from "./geo";
import { aggregateStats, computeStats, elevationGainLoss, elevationSeries } from "./stats";
import type { GpxPoint } from "./types";

const START = Date.parse("2024-05-18T07:00:00Z");

/** Builds a north-heading track with per-point elevation and a fixed sample interval. */
function track(
  elevations: number[],
  { intervalS = 1, stepDeg = 0.0001 }: { intervalS?: number; stepDeg?: number } = {},
): GpxPoint[] {
  return elevations.map((ele, i) => ({
    lat: 42.5 + i * stepDeg,
    lon: 1.5,
    ele,
    time: START + i * intervalS * 1000,
  }));
}

describe("haversineM", () => {
  it("matches a known distance", () => {
    // One degree of latitude is ~111.2 km.
    expect(haversineM(0, 0, 1, 0)).toBeCloseTo(111_195, -2);
    // Paris -> London great-circle is ~343.6 km.
    expect(haversineM(48.8566, 2.3522, 51.5074, -0.1278) / 1000).toBeCloseTo(343.56, 1);
  });

  it("is zero for identical points", () => {
    expect(haversineM(42.5, 1.5, 42.5, 1.5)).toBe(0);
  });
});

describe("elevationGainLoss", () => {
  // Hysteresis is deliberately conservative: it only banks a change once the
  // 3 m threshold is crossed, so a climb can be under-reported by up to one
  // threshold's worth of trailing metres. On real routes (500-2000 m of gain)
  // that is well under the ~1% we care about.
  const THRESHOLD_M = 3;

  it("accumulates a gradual climb whose per-step deltas are below the threshold", () => {
    // 0.5 m per sample for 200 samples = 100 m of real climbing. A naive
    // per-step threshold of 3 m would report zero gain here.
    const gradual = Array.from({ length: 201 }, (_, i) => 1000 + i * 0.5);
    const { gain, loss } = elevationGainLoss(gradual);
    expect(gain).toBeGreaterThan(100 - THRESHOLD_M);
    expect(gain).toBeLessThanOrEqual(100);
    expect(loss).toBe(0);
  });

  it("rejects jitter around a stable elevation", () => {
    const jitter = Array.from({ length: 400 }, (_, i) => 1000 + (i % 2 === 0 ? 1 : -1));
    const { gain, loss } = elevationGainLoss(jitter);
    expect(gain).toBe(0);
    expect(loss).toBe(0);
  });

  it("tracks gain and loss separately over a climb and descent", () => {
    const up = Array.from({ length: 101 }, (_, i) => 1000 + i);
    const down = Array.from({ length: 51 }, (_, i) => 1100 - i);
    const { gain, loss } = elevationGainLoss([...up, ...down]);
    expect(gain).toBeGreaterThan(100 - THRESHOLD_M);
    expect(gain).toBeLessThanOrEqual(100);
    expect(loss).toBeGreaterThan(50 - THRESHOLD_M);
    expect(loss).toBeLessThanOrEqual(50);
  });
});

describe("elevationSeries", () => {
  it("returns null when hardly any point carries elevation", () => {
    const points: GpxPoint[] = [
      { lat: 42.5, lon: 1.5, ele: 1000 },
      { lat: 42.51, lon: 1.5 },
      { lat: 42.52, lon: 1.5 },
      { lat: 42.53, lon: 1.5 },
    ];
    expect(elevationSeries(points)).toBeNull();
  });

  it("smooths single-sample spikes away", () => {
    const spiky = track([1000, 1000, 1000, 1400, 1000, 1000, 1000]);
    const smoothed = elevationSeries(spiky);
    expect(smoothed).not.toBeNull();
    // The 400 m spike is a median-filter outlier and must not survive.
    expect(Math.max(...(smoothed as number[]))).toBeLessThan(1100);
  });

  it("carries the last known elevation across gaps", () => {
    const points: GpxPoint[] = [
      { lat: 42.5, lon: 1.5, ele: 1000 },
      { lat: 42.501, lon: 1.5 },
      { lat: 42.502, lon: 1.5, ele: 1000 },
      { lat: 42.503, lon: 1.5, ele: 1000 },
    ];
    const smoothed = elevationSeries(points);
    expect(smoothed).toEqual([1000, 1000, 1000, 1000]);
  });
});

describe("computeStats", () => {
  it("returns neutral stats for a degenerate track", () => {
    const stats = computeStats([{ lat: 42.5, lon: 1.5 }]);
    expect(stats.distanceM).toBe(0);
    expect(stats.durationS).toBeNull();
    expect(stats.avgSpeedMps).toBeNull();
  });

  it("computes distance and duration over a straight track", () => {
    const points = track(new Array(101).fill(1000), { intervalS: 10 });
    const stats = computeStats(points);
    // 100 steps of 0.0001 deg latitude ~= 1112 m.
    expect(stats.distanceM).toBeCloseTo(1112, 0);
    expect(stats.durationS).toBe(1000);
  });

  it("excludes stationary stretches from moving time", () => {
    // 20 samples moving, then 100 samples parked at the same coordinate.
    const moving = track(new Array(21).fill(1000), { intervalS: 1 });
    const parked: GpxPoint[] = Array.from({ length: 100 }, (_, i) => ({
      lat: moving[moving.length - 1].lat,
      lon: 1.5,
      ele: 1000,
      time: Number(moving[moving.length - 1].time) + (i + 1) * 1000,
    }));
    const stats = computeStats([...moving, ...parked]);
    expect(stats.durationS).toBe(120);
    // Only the moving portion counts, so ~20 s not 120 s.
    expect(stats.movingTimeS).toBeGreaterThan(15);
    expect(stats.movingTimeS).toBeLessThan(25);
  });

  it("does not count a paused recording gap as moving time", () => {
    const points: GpxPoint[] = [
      { lat: 42.5, lon: 1.5, ele: 1000, time: START },
      { lat: 42.5001, lon: 1.5, ele: 1000, time: START + 1000 },
      // 2 hour gap: watch was paused, then resumed far away.
      { lat: 42.6, lon: 1.5, ele: 1000, time: START + 7_200_000 },
      { lat: 42.6001, lon: 1.5, ele: 1000, time: START + 7_201_000 },
    ];
    const stats = computeStats(points);
    expect(stats.durationS).toBe(7201);
    // Only the two 1 s moving samples count.
    expect(stats.movingTimeS).toBeCloseTo(2, 0);
  });

  it("measures max speed over a window, not between adjacent samples", () => {
    // Steady ~10 m/s with one 12 m single-sample wobble — small enough that the
    // outlier filter leaves it alone, so the window is what has to absorb it.
    const points: GpxPoint[] = Array.from({ length: 60 }, (_, i) => ({
      lat: 42.5 + i * 0.00009,
      lon: 1.5,
      ele: 1000,
      time: START + i * 1000,
    }));
    const clean = computeStats(points);
    points[30] = { ...points[30], lon: 1.50015 }; // ~12 m sideways wobble
    const wobbled = computeStats(points);

    expect(clean.maxSpeedMps).toBeLessThan(15);
    // Adjacent-sample speed at the wobble is ~16 m/s; averaged over 5 s it
    // barely registers.
    expect(wobbled.maxSpeedMps).toBeLessThan(15);
  });

  it("averages speed over moving time, not wall clock", () => {
    const moving = track(new Array(101).fill(1000), { intervalS: 1 });
    const parked: GpxPoint[] = Array.from({ length: 200 }, (_, i) => ({
      lat: moving[moving.length - 1].lat,
      lon: 1.5,
      ele: 1000,
      time: Number(moving[moving.length - 1].time) + (i + 1) * 1000,
    }));
    const stats = computeStats([...moving, ...parked]);
    const wallClockAvg = stats.distanceM / Number(stats.durationS);
    // Averaging over moving time gives a meaningfully higher figure.
    expect(stats.avgSpeedMps).toBeGreaterThan(wallClockAvg * 2);
  });

  it("handles a track with no timestamps at all", () => {
    const points: GpxPoint[] = Array.from({ length: 50 }, (_, i) => ({
      lat: 42.5 + i * 0.0001,
      lon: 1.5,
      ele: 1000 + i,
    }));
    const stats = computeStats(points);
    expect(stats.distanceM).toBeGreaterThan(0);
    expect(stats.durationS).toBeNull();
    expect(stats.movingTimeS).toBeNull();
    expect(stats.avgSpeedMps).toBeNull();
    expect(stats.maxSpeedMps).toBeNull();
  });

  it("does not overflow the argument limit on a very long track", () => {
    const long = track(
      Array.from({ length: 120_000 }, (_, i) => 1000 + Math.sin(i / 500) * 50),
      { intervalS: 1, stepDeg: 0.00001 },
    );
    expect(() => computeStats(long)).not.toThrow();
  });
});

describe("aggregateStats", () => {
  it("sums distance and climb, and takes the max of max speeds", () => {
    const a = computeStats(track(Array.from({ length: 101 }, (_, i) => 1000 + i)));
    const b = computeStats(track(Array.from({ length: 51 }, (_, i) => 2000 + i)));
    const total = aggregateStats([a, b]);
    expect(total.distanceM).toBeCloseTo(a.distanceM + b.distanceM, 3);
    expect(total.elevationGainM).toBeCloseTo(a.elevationGainM + b.elevationGainM, 3);
    expect(total.elevationMinM).toBe(Math.min(Number(a.elevationMinM), Number(b.elevationMinM)));
    expect(total.elevationMaxM).toBe(Math.max(Number(a.elevationMaxM), Number(b.elevationMaxM)));
    expect(total.maxSpeedMps).toBeCloseTo(
      Math.max(Number(a.maxSpeedMps), Number(b.maxSpeedMps)),
      6,
    );
  });

  it("returns neutral stats for no tracks", () => {
    expect(aggregateStats([]).distanceM).toBe(0);
  });
});
