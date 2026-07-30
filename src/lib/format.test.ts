import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration, formatElevation, formatPace, formatSpeed } from "./format";

describe("formatDistance", () => {
  it("shows one decimal under 100 units and none above", () => {
    expect(formatDistance(42_800)).toBe("42.8 km");
    expect(formatDistance(142_800)).toBe("143 km");
  });

  it("converts to miles", () => {
    expect(formatDistance(1609.344, "imperial")).toBe("1.0 mi");
    expect(formatDistance(42_195, "imperial")).toBe("26.2 mi");
  });
});

describe("formatElevation", () => {
  it("rounds to whole units", () => {
    expect(formatElevation(1240.6)).toBe("1,241 m");
    expect(formatElevation(304.8, "imperial")).toBe("1,000 ft");
  });
});

describe("formatSpeed", () => {
  it("converts m/s to km/h and mph", () => {
    expect(formatSpeed(10)).toBe("36.0 km/h");
    expect(formatSpeed(10, "imperial")).toBe("22.4 mph");
  });
});

describe("formatPace", () => {
  it("formats minutes per kilometre", () => {
    // 1000 m in 300 s is a 5:00/km pace.
    expect(formatPace(1000 / 300)).toBe("5:00 /km");
  });

  it("formats minutes per mile", () => {
    expect(formatPace(1000 / 300, "imperial")).toBe("8:03 /mi");
  });

  it("carries rounded seconds into the next minute instead of printing :60", () => {
    // Just under 5:00/km — must read 5:00, never 4:60.
    const mps = 1000 / 299.7;
    expect(formatPace(mps)).toBe("5:00 /km");
  });

  it("guards against a zero or negative speed", () => {
    expect(formatPace(0)).toBe("—");
    expect(formatPace(-1)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("uses hours and minutes above an hour", () => {
    expect(formatDuration(3 * 3600 + 12 * 60)).toBe("3h 12m");
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe("3h 05m");
  });

  it("uses minutes and seconds under an hour", () => {
    expect(formatDuration(48 * 60 + 20)).toBe("48m 20s");
    expect(formatDuration(45)).toBe("45s");
  });

  it("handles invalid input", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });
});
