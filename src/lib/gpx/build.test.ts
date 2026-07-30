import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTrack } from "./build";
import { decodePolyline } from "./encode";
import { parseGpx } from "./parse";
import { computeStats } from "./stats";
import type { GpxPoint } from "./types";

const START = Date.parse("2024-05-18T07:00:00Z");

const fixture = readFileSync(
  fileURLToPath(new URL("../../../test/fixtures/sample.gpx", import.meta.url)),
  "utf8",
);

/** A densely sampled, winding, climbing track — a stand-in for a real ride. */
function realisticTrack(count = 8000): GpxPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / 400;
    return {
      lat: 42.5 + t * 0.003 + Math.sin(t * 4) * 0.0007,
      lon: 1.5 + Math.cos(t * 3) * 0.0012,
      // A climb with a descent at the end, plus realistic metre-scale noise.
      ele: 1000 + Math.sin(t / 3) * 320 + (i % 3 === 0 ? 1.2 : -0.8),
      time: START + i * 1000,
      hr: 120 + Math.round(Math.sin(t) * 20),
    };
  });
}

describe("buildTrack", () => {
  it("produces index-aligned series of equal length", () => {
    const built = buildTrack(realisticTrack());
    const coords = decodePolyline(built.series.geometry);
    const stored = built.series.pointCountStored;

    expect(coords).toHaveLength(stored);
    expect(built.series.distances).toHaveLength(stored);
    expect(built.series.elevations).toHaveLength(stored);
    expect(built.series.timeOffsets).toHaveLength(stored);
  });

  it("compresses the geometry substantially", () => {
    const points = realisticTrack();
    const built = buildTrack(points);
    expect(built.series.pointCountOriginal).toBe(points.length);
    expect(built.series.pointCountStored).toBeLessThan(points.length * 0.25);
  });

  it("reports stats computed from full resolution, not from the simplified line", () => {
    // The invariant the whole design rests on: throwing away 80%+ of the points
    // must not move the numbers shown to a viewer.
    const points = realisticTrack();
    const built = buildTrack(points);
    const fullStats = computeStats(points);

    expect(built.stats.distanceM).toBeCloseTo(fullStats.distanceM, 6);
    expect(built.stats.elevationGainM).toBeCloseTo(fullStats.elevationGainM, 6);
    expect(built.stats.elevationLossM).toBeCloseTo(fullStats.elevationLossM, 6);
    expect(built.stats.durationS).toBe(fullStats.durationS);
    expect(built.stats.movingTimeS).toBeCloseTo(Number(fullStats.movingTimeS), 6);
    expect(built.stats.maxSpeedMps).toBeCloseTo(Number(fullStats.maxSpeedMps), 6);

    // And the stored distance series must still end at the true total.
    const storedTotal = built.series.distances.at(-1) as number;
    expect(storedTotal).toBeCloseTo(fullStats.distanceM, 0);
  });

  it("keeps distance monotonic and starting at zero", () => {
    const built = buildTrack(realisticTrack());
    const { distances } = built.series;
    expect(distances[0]).toBe(0);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
    }
  });

  it("keeps time offsets starting at zero and non-decreasing", () => {
    const built = buildTrack(realisticTrack());
    const offsets = built.series.timeOffsets as number[];
    expect(offsets[0]).toBe(0);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
    }
  });

  it("filters GPS glitches out of the stored geometry and the distance total", () => {
    const clean = realisticTrack(2000);
    const cleanBuilt = buildTrack(clean);

    const glitched = clean.map((p) => ({ ...p }));
    glitched[900] = { ...glitched[900], lon: glitched[900].lon + 0.004 }; // ~330 m jump
    const glitchedBuilt = buildTrack(glitched);

    expect(glitchedBuilt.droppedOutliers).toBe(1);
    // Distance must land back on the clean figure, not ~660 m over it.
    expect(glitchedBuilt.stats.distanceM).toBeCloseTo(cleanBuilt.stats.distanceM, 0);
  });

  it("records the bounding box of the track", () => {
    const built = buildTrack(realisticTrack(1000));
    const [west, south, east, north] = built.bbox;
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
    expect(west).toBeGreaterThan(1.49);
    expect(north).toBeLessThan(42.6);
  });

  it("keeps the stored line within tolerance of every original point", () => {
    const points = realisticTrack(3000);
    const built = buildTrack(points);
    const coords = decodePolyline(built.series.geometry);

    // Measured against the polyline (nearest point on any segment), not against
    // the nearest vertex: a point in the middle of a long straight segment is
    // far from both endpoints yet exactly on the line, so a vertex-based check
    // would report a large error for geometry that is in fact perfect.
    const mPerDeg = 111_320;
    const scaleLon = Math.cos((42.5 * Math.PI) / 180);
    const project = (lat: number, lon: number): [number, number] => [
      lon * mPerDeg * scaleLon,
      lat * mPerDeg,
    ];

    let worst = 0;
    for (const p of points) {
      const [px, py] = project(p.lat, p.lon);
      let nearest = Infinity;
      for (let i = 0; i < coords.length - 1; i++) {
        const [ax, ay] = project(coords[i][0], coords[i][1]);
        const [bx, by] = project(coords[i + 1][0], coords[i + 1][1]);
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        nearest = Math.min(nearest, Math.hypot(px - ax - t * dx, py - ay - t * dy));
      }
      worst = Math.max(worst, nearest);
    }

    // 2.5 m simplification tolerance + ~1.1 m polyline quantisation.
    expect(worst).toBeLessThan(5);
  });

  it("handles a track with no elevation or time data", () => {
    const bare: GpxPoint[] = Array.from({ length: 200 }, (_, i) => ({
      lat: 42.5 + i * 0.0002,
      lon: 1.5 + Math.sin(i / 10) * 0.0004,
    }));
    const built = buildTrack(bare);
    expect(built.series.elevations).toBeNull();
    expect(built.series.timeOffsets).toBeNull();
    expect(built.startedAt).toBeNull();
    expect(built.stats.distanceM).toBeGreaterThan(0);
    expect(built.stats.elevationGainM).toBe(0);
  });

  it("builds from the real fixture file end to end", () => {
    const [track] = parseGpx(fixture).tracks;
    const built = buildTrack(track.points);

    // 5 points spanning ~445 m north with 40 m of climb then 10 m of descent.
    expect(built.series.pointCountOriginal).toBe(5);
    expect(built.stats.distanceM).toBeCloseTo(445, 0);
    expect(built.startedAt).toBe(Date.parse("2024-05-18T07:00:00Z"));
    expect(built.stats.durationS).toBe(120);
    expect(built.stats.elevationMaxM).toBeGreaterThan(1000);
  });

  it("degrades gracefully on a two-point track", () => {
    const built = buildTrack([
      { lat: 42.5, lon: 1.5, ele: 1000, time: START },
      { lat: 42.51, lon: 1.5, ele: 1010, time: START + 60_000 },
    ]);
    expect(built.series.pointCountStored).toBe(2);
    expect(built.stats.distanceM).toBeGreaterThan(1000);
  });
});
