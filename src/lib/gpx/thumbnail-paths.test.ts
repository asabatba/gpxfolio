import { describe, expect, it } from "vitest";
import { encodePolyline } from "./encode";
import { buildThumbnailPaths } from "./thumbnail-paths";

describe("buildThumbnailPaths", () => {
  it("returns an empty array for no tracks", () => {
    expect(buildThumbnailPaths([], 320, 180, 14)).toEqual([]);
  });

  it("fits the path inside the padded box", () => {
    const geometry = encodePolyline([
      [42.5, 1.5],
      [42.51, 1.52],
      [42.49, 1.55],
    ]);
    const [path] = buildThumbnailPaths([{ geometry, color: "#e5007d" }], 320, 180, 14);

    expect(path.color).toBe("#e5007d");
    const coords = [...path.d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(coords).toHaveLength(3);
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(14);
      expect(x).toBeLessThanOrEqual(320 - 14);
      expect(y).toBeGreaterThanOrEqual(14);
      expect(y).toBeLessThanOrEqual(180 - 14);
    }
  });

  it("preserves real-world proportions by scaling longitude by cos(latitude)", () => {
    // A square in real distance at 60°N spans roughly 2x more longitude than
    // latitude degrees — the projected box should still come out square-ish,
    // not stretched, because of the cos(lat) correction.
    const geometry = encodePolyline([
      [60, 0],
      [60, 0.02], // ~1.1 km east at 60°N (0.02° * cos(60°) * 111km/deg)
      [60.01, 0.02], // ~1.1 km north
      [60.01, 0],
    ]);
    const [path] = buildThumbnailPaths([{ geometry, color: "#000" }], 320, 320, 20);
    const coords = [...path.d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const xSpan = Math.max(...xs) - Math.min(...xs);
    const ySpan = Math.max(...ys) - Math.min(...ys);
    expect(xSpan / ySpan).toBeCloseTo(1, 0);
  });

  it("draws one path per track, each starting with M and continuing with L", () => {
    const a = encodePolyline([
      [42.5, 1.5],
      [42.51, 1.51],
    ]);
    const b = encodePolyline([
      [42.6, 1.6],
      [42.61, 1.61],
    ]);
    const paths = buildThumbnailPaths(
      [
        { geometry: a, color: "#111" },
        { geometry: b, color: "#222" },
      ],
      320,
      180,
      14,
    );
    expect(paths).toHaveLength(2);
    expect(paths[0].d.startsWith("M")).toBe(true);
    expect(paths[0].d).toContain("L");
    expect(paths[1].color).toBe("#222");
  });
});
