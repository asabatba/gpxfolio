import { describe, expect, it } from "vitest";
import { decodePolyline, encodePolyline, toLngLat } from "./encode";

describe("encodePolyline / decodePolyline", () => {
  it("matches the reference example from the Google polyline spec", () => {
    const encoded = encodePolyline([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
    expect(encoded).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });

  it("round-trips coordinates to ~1 m", () => {
    const coords: Array<[number, number]> = Array.from({ length: 500 }, (_, i) => [
      42.5 + i * 0.0001,
      1.5 + Math.sin(i / 10) * 0.001,
    ]);
    const decoded = decodePolyline(encodePolyline(coords));
    expect(decoded).toHaveLength(coords.length);
    for (let i = 0; i < coords.length; i++) {
      // Precision 5 quantises to 1e-5 deg, ~1.1 m.
      expect(decoded[i][0]).toBeCloseTo(coords[i][0], 5);
      expect(decoded[i][1]).toBeCloseTo(coords[i][1], 5);
    }
  });

  it("does not accumulate drift over a long line", () => {
    // Diffing rounded values (rather than rounding diffs) is what keeps the
    // last point as accurate as the first.
    const coords: Array<[number, number]> = Array.from({ length: 20_000 }, (_, i) => [
      42.5 + i * 0.00007,
      1.5 + i * 0.00003,
    ]);
    const decoded = decodePolyline(encodePolyline(coords));
    const lastIndex = coords.length - 1;
    expect(decoded[lastIndex][0]).toBeCloseTo(coords[lastIndex][0], 5);
    expect(decoded[lastIndex][1]).toBeCloseTo(coords[lastIndex][1], 5);
  });

  it("handles negative and antimeridian-adjacent coordinates", () => {
    const coords: Array<[number, number]> = [
      [-33.8688, 151.2093],
      [-41.2865, 174.7762],
      [64.1466, -21.9426],
    ];
    const decoded = decodePolyline(encodePolyline(coords));
    for (let i = 0; i < coords.length; i++) {
      expect(decoded[i][0]).toBeCloseTo(coords[i][0], 5);
      expect(decoded[i][1]).toBeCloseTo(coords[i][1], 5);
    }
  });

  it("encodes an empty list to an empty string", () => {
    expect(encodePolyline([])).toBe("");
    expect(decodePolyline("")).toEqual([]);
  });

  it("is substantially smaller than the equivalent JSON", () => {
    const coords: Array<[number, number]> = Array.from({ length: 2000 }, (_, i) => [
      42.5 + i * 0.0001,
      1.5 + Math.sin(i / 20) * 0.002,
    ]);
    const encodedSize = encodePolyline(coords).length;
    const jsonSize = JSON.stringify(coords.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)])).length;
    expect(encodedSize).toBeLessThan(jsonSize / 2);
  });

  it("swaps to lng/lat for MapLibre", () => {
    expect(
      toLngLat([
        [42.5, 1.5],
        [43, 2],
      ]),
    ).toEqual([
      [1.5, 42.5],
      [2, 43],
    ]);
  });
});
