import { describe, expect, it } from "vitest";
import { denoise } from "./denoise";
import { cumulativeDistances } from "./geo";
import { computeStats } from "./stats";
import type { GpxPoint } from "./types";

const START = Date.parse("2024-05-18T07:00:00Z");

function steadyTrack(count: number): GpxPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: 42.5 + i * 0.00009, // ~10 m/s at 1 Hz
    lon: 1.5,
    ele: 1000,
    time: START + i * 1000,
  }));
}

describe("denoise", () => {
  it("leaves a clean track untouched", () => {
    const points = steadyTrack(50);
    const { points: cleaned, dropped } = denoise(points);
    expect(dropped).toBe(0);
    expect(cleaned).toHaveLength(50);
  });

  it("removes a teleport glitch and the phantom distance it adds", () => {
    const points = steadyTrack(60);
    const cleanDistance = cumulativeDistances(points).at(-1) as number;

    // One fix lands ~200 m sideways, then recording resumes normally.
    points[30] = { ...points[30], lon: 1.5024 };
    const glitchedDistance = cumulativeDistances(points).at(-1) as number;

    const { points: cleaned, dropped } = denoise(points);
    const repairedDistance = cumulativeDistances(cleaned).at(-1) as number;

    expect(dropped).toBe(1);
    expect(cleaned).toHaveLength(59);
    // The glitch added ~400 m of phantom distance; denoising gives it back.
    expect(glitchedDistance - cleanDistance).toBeGreaterThan(300);
    expect(repairedDistance).toBeCloseTo(cleanDistance, 0);
  });

  it("keeps small wobbles that are within plausible movement", () => {
    const points = steadyTrack(40);
    points[20] = { ...points[20], lon: 1.50015 }; // ~12 m
    const { dropped } = denoise(points);
    expect(dropped).toBe(0);
  });

  it("resynchronises instead of deleting the track when the reference is the bad fix", () => {
    // First fix is in the wrong country; everything after it is fine.
    const points = steadyTrack(40);
    points[0] = { ...points[0], lat: 10, lon: 10 };
    const { points: cleaned } = denoise(points);
    // Without the resync guard this would drop all 39 good points.
    expect(cleaned.length).toBeGreaterThan(30);
  });

  it("never drops the final point, which defines the end of the route", () => {
    const points = steadyTrack(20);
    const last = { ...points[19], lat: 43.9 };
    points[19] = last;
    const { points: cleaned } = denoise(points);
    expect(cleaned.at(-1)?.lat).toBe(43.9);
  });

  it("passes through tracks with no timestamps, where speed cannot be judged", () => {
    const points: GpxPoint[] = Array.from({ length: 20 }, (_, i) => ({
      lat: 42.5 + i * 0.0001,
      lon: 1.5,
    }));
    points[10] = { lat: 43.5, lon: 2.5 };
    const { points: cleaned, dropped } = denoise(points);
    expect(dropped).toBe(0);
    expect(cleaned).toHaveLength(20);
  });

  it("handles degenerate input", () => {
    expect(denoise([]).points).toHaveLength(0);
    expect(denoise([{ lat: 1, lon: 2 }]).points).toHaveLength(1);
  });

  it("drops a sustained multi-sample drift burst that a single-step check would miss", () => {
    // Modelled on a real offending hike: a rest stop (near-stationary, ~0.3 m/s
    // — GPS fix quality degrades and sample spacing gets irregular), then an
    // 8 s straight-line "catch-up" burst at ~20 m/s that never returns to the
    // rest position. No single step exceeds the absolute 60 m/s ceiling, so
    // only a check relative to the track's recent pace can catch it.
    const rest: GpxPoint[] = Array.from({ length: 15 }, (_, i) => ({
      lat: 42.61 + i * 0.000003,
      lon: 1.5,
      ele: 2550,
      time: START + i * 5000,
    }));
    const restEnd = rest[rest.length - 1];
    const burst: GpxPoint[] = Array.from({ length: 8 }, (_, i) => ({
      lat: Number(restEnd.lat) + (i + 1) * 0.00018, // ~20 m/step
      lon: 1.5,
      ele: 2550,
      time: Number(restEnd.time) + (i + 1) * 1000,
    }));
    const burstEnd = burst[burst.length - 1];
    const resumed: GpxPoint[] = Array.from({ length: 15 }, (_, i) => ({
      lat: Number(burstEnd.lat) + i * 0.000003,
      lon: 1.5,
      ele: 2550,
      time: Number(burstEnd.time) + (i + 1) * 5000,
    }));

    const points = [...rest, ...burst, ...resumed];
    const { points: cleaned, dropped } = denoise(points);

    expect(dropped).toBeGreaterThan(0);

    const before = computeStats(points).maxSpeedMps as number;
    const after = computeStats(cleaned).maxSpeedMps as number;
    // The burst reads as a wildly unrealistic speed before denoising...
    expect(before * 3.6).toBeGreaterThan(50);
    // ...and like a hike, not a car, after.
    expect(after * 3.6).toBeLessThan(30);
  });

  it("does not mistake resuming a normal walking pace after a rest stop for noise", () => {
    // The rest stop makes the recent-pace baseline near zero, so a plain
    // ratio check would see any resumed movement as an "infinite" multiple of
    // it. The floor on the relative check exists precisely to protect this case.
    const rest: GpxPoint[] = Array.from({ length: 15 }, (_, i) => ({
      lat: 42.61 + i * 0.000003,
      lon: 1.5,
      ele: 2550,
      time: START + i * 5000,
    }));
    const restEnd = rest[rest.length - 1];
    const walking: GpxPoint[] = Array.from({ length: 20 }, (_, i) => ({
      lat: Number(restEnd.lat) + (i + 1) * 0.0000117, // ~1.3 m/s, a normal walking pace
      lon: 1.5,
      ele: 2550,
      time: Number(restEnd.time) + (i + 1) * 1000,
    }));
    const { dropped } = denoise([...rest, ...walking]);
    expect(dropped).toBe(0);
  });

  it("eventually accepts a real sustained fast segment instead of erasing it", () => {
    // A genuine fast stretch mid-track (e.g. a shuttle) that outlasts the
    // relative-drift escape valve must eventually be trusted, not deleted in
    // full — the same "don't punish a real divergence forever" principle as
    // the absolute-ceiling resync above, just on a longer, time-based leash.
    const rest: GpxPoint[] = Array.from({ length: 10 }, (_, i) => ({
      lat: 42.61,
      lon: 1.5 + i * 0.0000005,
      ele: 2550,
      time: START + i * 5000,
    }));
    const restEnd = rest[rest.length - 1];
    const fast: GpxPoint[] = Array.from({ length: 40 }, (_, i) => ({
      lat: 42.61,
      lon: Number(restEnd.lon) + (i + 1) * 0.0001, // ~10 m/s, well past the relative threshold
      ele: 2550,
      time: Number(restEnd.time) + (i + 1) * 1000,
    }));

    const { points: cleaned, dropped } = denoise([...rest, ...fast]);

    expect(dropped).toBeGreaterThan(0);
    expect(dropped).toBeLessThan(fast.length);
    // More than just the always-kept final point survived from the fast run.
    expect(cleaned.length).toBeGreaterThan(rest.length + 5);
  });
});
