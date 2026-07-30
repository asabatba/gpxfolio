import { describe, expect, it } from "vitest";
import { denoise } from "./denoise";
import { cumulativeDistances } from "./geo";
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
});
