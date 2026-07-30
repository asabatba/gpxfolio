import { describe, expect, it } from "vitest";
import { inferCameraOffsetMinutes } from "./offset";

/** Builds a naive "as-if-UTC" epoch the way exif.ts does, from true UTC + a camera offset. */
function naiveFromTrue(trueUtcMs: number, offsetMinutes: number): number {
  return trueUtcMs + offsetMinutes * 60_000;
}

describe("inferCameraOffsetMinutes", () => {
  it("returns null for an empty batch", () => {
    expect(inferCameraOffsetMinutes([], 0, 1)).toBeNull();
  });

  it("recovers a whole-hour positive offset", () => {
    const trackStart = Date.UTC(2024, 6, 15, 8, 0, 0);
    const trackEnd = Date.UTC(2024, 6, 15, 14, 0, 0);
    const trueTimes = [
      Date.UTC(2024, 6, 15, 9, 0, 0),
      Date.UTC(2024, 6, 15, 11, 0, 0),
      Date.UTC(2024, 6, 15, 13, 0, 0),
    ];
    const naive = trueTimes.map((t) => naiveFromTrue(t, 120));

    const result = inferCameraOffsetMinutes(naive, trackStart, trackEnd);
    expect(result?.offsetMinutes).toBe(120);
    expect(result?.confidence).toBe(1);
  });

  it("recovers a negative offset", () => {
    const trackStart = Date.UTC(2024, 6, 15, 20, 0, 0);
    const trackEnd = Date.UTC(2024, 6, 16, 2, 0, 0);
    const trueTimes = [Date.UTC(2024, 6, 15, 21, 0, 0), Date.UTC(2024, 6, 16, 1, 0, 0)];
    const naive = trueTimes.map((t) => naiveFromTrue(t, -300));

    const result = inferCameraOffsetMinutes(naive, trackStart, trackEnd);
    expect(result?.offsetMinutes).toBe(-300);
  });

  it("recovers a half-hour offset", () => {
    const trackStart = Date.UTC(2024, 6, 15, 4, 0, 0);
    const trackEnd = Date.UTC(2024, 6, 15, 8, 0, 0);
    const trueTimes = [Date.UTC(2024, 6, 15, 5, 0, 0), Date.UTC(2024, 6, 15, 7, 0, 0)];
    const naive = trueTimes.map((t) => naiveFromTrue(t, 330)); // e.g. India Standard Time

    const result = inferCameraOffsetMinutes(naive, trackStart, trackEnd);
    expect(result?.offsetMinutes).toBe(330);
  });

  it("ties break toward the median of the tied band", () => {
    // A single naive timestamp already sitting on the track instant makes
    // every offset within +/- the tolerance window tie at confidence 1; the
    // median of that symmetric band is 0, which is also the correct answer
    // here since the photo needs no correction at all.
    const trackStart = Date.UTC(2024, 6, 15, 12, 0, 0);
    const trackEnd = trackStart;
    const naive = [trackStart]; // naive already sits exactly on the track instant

    const result = inferCameraOffsetMinutes(naive, trackStart, trackEnd);
    expect(result?.offsetMinutes).toBe(0);
    expect(result?.confidence).toBe(1);
  });

  it("gives low confidence when timestamps don't cluster near the track at any offset", () => {
    const trackStart = Date.UTC(2024, 6, 15, 8, 0, 0);
    const trackEnd = Date.UTC(2024, 6, 15, 9, 0, 0);
    // A week off — no offset within +/-14h brings this inside the tolerant window.
    const naive = [Date.UTC(2024, 6, 22, 8, 30, 0)];

    const result = inferCameraOffsetMinutes(naive, trackStart, trackEnd);
    expect(result?.confidence).toBe(0);
  });
});
