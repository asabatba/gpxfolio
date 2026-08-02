import { describe, expect, it } from "vitest";
import {
  formatDateISO,
  formatDistance,
  formatDuration,
  formatElevation,
  formatPace,
  formatSpeed,
} from "./format";

describe("formatDistance", () => {
  it("shows one decimal under 100 km and none above", () => {
    expect(formatDistance(42_800)).toBe("42.8 km");
    expect(formatDistance(142_800)).toBe("143 km");
  });

  it("handles short distances", () => {
    expect(formatDistance(450)).toBe("0.5 km");
    expect(formatDistance(0)).toBe("0.0 km");
  });
});

describe("formatElevation", () => {
  it("rounds to whole metres and groups thousands", () => {
    expect(formatElevation(1240.6)).toBe("1,241 m");
    expect(formatElevation(0)).toBe("0 m");
  });
});

describe("formatSpeed", () => {
  it("converts m/s to km/h", () => {
    expect(formatSpeed(10)).toBe("36.0 km/h");
  });
});

describe("formatPace", () => {
  it("formats minutes per kilometre", () => {
    // 1000 m in 300 s is a 5:00/km pace.
    expect(formatPace(1000 / 300)).toBe("5:00 /km");
  });

  it("carries rounded seconds into the next minute instead of printing :60", () => {
    expect(formatPace(1000 / 299.7)).toBe("5:00 /km");
  });

  it("guards against a zero or negative speed", () => {
    expect(formatPace(0)).toBe("—");
    expect(formatPace(-1)).toBe("—");
  });
});

describe("formatDateISO", () => {
  it("formats as YYYY-MM-DD in UTC", () => {
    expect(formatDateISO(new Date("2026-08-03T14:32:00Z"))).toBe("2026-08-03");
  });

  it("handles a missing date", () => {
    expect(formatDateISO(null)).toBe("");
    expect(formatDateISO(undefined)).toBe("");
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
