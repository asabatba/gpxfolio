import { describe, expect, it } from "vitest";
import { haversineM } from "./geo";
import { DEFAULT_TOLERANCE_M, simplifyIndices, simplifyToBudget } from "./simplify";
import type { GpxPoint } from "./types";

function pointsFrom(coords: Array<[number, number]>): GpxPoint[] {
  return coords.map(([lat, lon]) => ({ lat, lon }));
}

/** Perpendicular distance from `p` to segment `a`-`b`, in metres. */
function distanceToSegment(p: GpxPoint, a: GpxPoint, b: GpxPoint): number {
  const mPerDegLat = 111_320;
  const mPerDegLon = mPerDegLat * Math.cos((a.lat * Math.PI) / 180);
  const px = (p.lon - a.lon) * mPerDegLon;
  const py = (p.lat - a.lat) * mPerDegLat;
  const bx = (b.lon - a.lon) * mPerDegLon;
  const by = (b.lat - a.lat) * mPerDegLat;
  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.hypot(px, py);
  let t = (px * bx + py * by) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Worst deviation of any original point from the simplified polyline. */
function maxDeviationM(points: GpxPoint[], indices: number[]): number {
  let worst = 0;
  for (let seg = 0; seg < indices.length - 1; seg++) {
    const a = points[indices[seg]];
    const b = points[indices[seg + 1]];
    for (let i = indices[seg] + 1; i < indices[seg + 1]; i++) {
      worst = Math.max(worst, distanceToSegment(points[i], a, b));
    }
  }
  return worst;
}

describe("simplifyIndices", () => {
  it("returns every index for tracks of two points or fewer", () => {
    expect(simplifyIndices(pointsFrom([[42.5, 1.5]]), 2.5)).toEqual([0]);
    expect(
      simplifyIndices(
        pointsFrom([
          [42.5, 1.5],
          [42.6, 1.6],
        ]),
        2.5,
      ),
    ).toEqual([0, 1]);
  });

  it("collapses a straight line to its endpoints", () => {
    const straight = pointsFrom(
      Array.from({ length: 500 }, (_, i) => [42.5 + i * 0.0001, 1.5] as [number, number]),
    );
    expect(simplifyIndices(straight, DEFAULT_TOLERANCE_M)).toEqual([0, 499]);
  });

  it("always keeps the first and last point", () => {
    const wiggly = pointsFrom(
      Array.from(
        { length: 300 },
        (_, i) => [42.5 + i * 0.0002, 1.5 + Math.sin(i / 4) * 0.001] as [number, number],
      ),
    );
    const indices = simplifyIndices(wiggly, DEFAULT_TOLERANCE_M);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(299);
  });

  it("returns strictly increasing indices", () => {
    const wiggly = pointsFrom(
      Array.from(
        { length: 400 },
        (_, i) => [42.5 + i * 0.0002, 1.5 + Math.sin(i / 7) * 0.002] as [number, number],
      ),
    );
    const indices = simplifyIndices(wiggly, DEFAULT_TOLERANCE_M);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it("keeps every original point within the requested tolerance", () => {
    // A winding mountain-road shape, the case that matters for accuracy.
    const winding = pointsFrom(
      Array.from({ length: 2000 }, (_, i) => {
        const t = i / 100;
        return [42.5 + t * 0.004 + Math.sin(t * 3) * 0.0008, 1.5 + Math.cos(t * 2) * 0.0015] as [
          number,
          number,
        ];
      }),
    );

    for (const tolerance of [1, 2.5, 10]) {
      const indices = simplifyIndices(winding, tolerance);
      // A small epsilon covers the difference between the equirectangular
      // projection used internally and the check above.
      expect(maxDeviationM(winding, indices)).toBeLessThanOrEqual(tolerance * 1.05);
    }
  });

  it("removes the large majority of points on a densely sampled track", () => {
    // 1 Hz recording of a gentle curve — typical of a real GPS file.
    const dense = pointsFrom(
      Array.from({ length: 10_000 }, (_, i) => {
        const t = i / 1000;
        return [42.5 + t * 0.01 + Math.sin(t) * 0.0005, 1.5 + Math.cos(t / 2) * 0.0008] as [
          number,
          number,
        ];
      }),
    );
    const indices = simplifyIndices(dense, DEFAULT_TOLERANCE_M);
    expect(indices.length).toBeLessThan(dense.length * 0.2);
  });

  it("handles a closed loop, where the first and last point coincide", () => {
    const loop = pointsFrom(
      Array.from({ length: 360 }, (_, i) => {
        const a = (i / 360) * Math.PI * 2;
        return [42.5 + Math.sin(a) * 0.01, 1.5 + Math.cos(a) * 0.01] as [number, number];
      }),
    );
    // Close it exactly, making the outer segment degenerate.
    loop.push({ ...loop[0] });
    const indices = simplifyIndices(loop, DEFAULT_TOLERANCE_M);
    expect(indices.length).toBeGreaterThan(10);
    expect(indices.at(-1)).toBe(loop.length - 1);
    expect(maxDeviationM(loop, indices)).toBeLessThanOrEqual(DEFAULT_TOLERANCE_M * 1.05);
  });

  it("does not overflow the stack on a very long track", () => {
    const huge = pointsFrom(
      Array.from(
        { length: 200_000 },
        (_, i) => [42.5 + i * 0.000002, 1.5 + Math.sin(i / 50) * 0.00002] as [number, number],
      ),
    );
    expect(() => simplifyIndices(huge, DEFAULT_TOLERANCE_M)).not.toThrow();
  });
});

describe("simplifyToBudget", () => {
  it("escalates the tolerance until the point budget is met", () => {
    // Deliberately jagged, so 2.5 m alone keeps far more than the budget.
    const jagged = pointsFrom(
      Array.from(
        { length: 40_000 },
        (_, i) =>
          [42.5 + i * 0.00001, 1.5 + (i % 2 === 0 ? 0.0002 : -0.0002)] as [number, number],
      ),
    );
    const { indices, toleranceUsedM } = simplifyToBudget(jagged, DEFAULT_TOLERANCE_M, 3000);
    expect(indices.length).toBeLessThanOrEqual(3000);
    expect(toleranceUsedM).toBeGreaterThan(DEFAULT_TOLERANCE_M);
  });

  it("uses most of the budget instead of overshooting past it", () => {
    // A noisy but real-shaped track: a winding route with metre-scale jitter on
    // top, so detail falls away gradually as tolerance rises. Plain doubling
    // dropped this to a few hundred points; the refinement pass must land near
    // the budget instead of far under it.
    const noisy = pointsFrom(
      Array.from({ length: 100_000 }, (_, i) => {
        const t = i / 400;
        return [
          42.5 + t * 0.0005 + Math.sin(t * 4) * 0.0007,
          1.5 + Math.cos(t * 3) * 0.0012 + (i % 2 === 0 ? 0.0002 : -0.0002),
        ] as [number, number];
      }),
    );
    const { indices } = simplifyToBudget(noisy, DEFAULT_TOLERANCE_M, 6000);
    expect(indices.length).toBeLessThanOrEqual(6000);
    expect(indices.length).toBeGreaterThan(3000);
  });

  it("stays fast on a large jagged track, where RDP is worst-case", () => {
    // A zigzag defeats naive RDP: this took over 12s before windowing.
    const jagged = pointsFrom(
      Array.from(
        { length: 100_000 },
        (_, i) =>
          [42.5 + i * 0.000004, 1.5 + (i % 2 === 0 ? 0.0002 : -0.0002)] as [number, number],
      ),
    );
    const started = performance.now();
    simplifyToBudget(jagged);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("leaves the tolerance alone when the track already fits", () => {
    const short = pointsFrom(
      Array.from(
        { length: 100 },
        (_, i) => [42.5 + i * 0.0005, 1.5 + Math.sin(i / 5) * 0.0005] as [number, number],
      ),
    );
    const { toleranceUsedM } = simplifyToBudget(short, DEFAULT_TOLERANCE_M, 6000);
    expect(toleranceUsedM).toBe(DEFAULT_TOLERANCE_M);
  });

  it("preserves overall track length within a fraction of a percent", () => {
    const winding = pointsFrom(
      Array.from({ length: 5000 }, (_, i) => {
        const t = i / 250;
        return [42.5 + t * 0.002 + Math.sin(t * 4) * 0.0006, 1.5 + Math.cos(t * 3) * 0.001] as [
          number,
          number,
        ];
      }),
    );

    const length = (pts: GpxPoint[]) => {
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        total += haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
      }
      return total;
    };

    const { indices } = simplifyToBudget(winding);
    const simplified = indices.map((i) => winding[i]);
    const ratio = length(simplified) / length(winding);
    // Simplification always shortens slightly by cutting corners; at 2.5 m
    // that loss must stay negligible.
    expect(ratio).toBeGreaterThan(0.995);
    expect(ratio).toBeLessThanOrEqual(1);
  });
});
