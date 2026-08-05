import { describe, expect, it } from "vitest";
import { encodePolyline } from "./gpx/encode";
import { type OgImageRoute, buildOgSvg, wrapLines } from "./og-image";

const BASE_ROUTE: OgImageRoute = {
  title: "A Weekend in the Pyrenees",
  activityType: "Hike",
  distanceM: 42_195,
  elevationGainM: 1830,
  startedAt: new Date("2025-06-14T08:00:00Z"),
  siteName: "gpxfolio",
  tracks: [
    {
      geometry: encodePolyline([
        [42.5, 1.5],
        [42.51, 1.52],
        [42.49, 1.55],
      ]),
      color: "#e5007d",
    },
  ],
};

describe("wrapLines", () => {
  it("keeps a short title on one line", () => {
    expect(wrapLines("Short title", 400, 56, 3)).toEqual(["Short title"]);
  });

  it("wraps a long title across multiple lines without dropping words", () => {
    const text = "A very long route title that should wrap across several lines of text";
    const lines = wrapLines(text, 380, 56, 3);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    // Every word survives somewhere in the wrapped output (ellipsis aside).
    expect(lines.join(" ").replace(/…$/, "")).toContain("A very long route title");
  });

  it("truncates with an ellipsis rather than overflowing past maxLines", () => {
    const text = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const lines = wrapLines(text, 300, 56, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });

  it("never returns more lines than maxLines even for a single unbroken word", () => {
    const lines = wrapLines("supercalifragilisticexpialidocious", 50, 56, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});

describe("buildOgSvg", () => {
  it("produces a well-formed SVG with the route's title, stats and track colour", () => {
    const svg = buildOgSvg(BASE_ROUTE);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("Weekend");
    expect(svg).toContain("Pyrenees");
    expect(svg).toContain("#e5007d");
    expect(svg).toContain("Hike");
  });

  it("escapes XML-sensitive characters in the title", () => {
    const svg = buildOgSvg({ ...BASE_ROUTE, title: `<Tom & Jerry's "Ride">` });
    expect(svg).not.toContain("<Tom");
    expect(svg).toContain("&lt;Tom");
    expect(svg).toContain("&amp;");
  });

  it("renders with no tracks at all, without throwing", () => {
    expect(() => buildOgSvg({ ...BASE_ROUTE, tracks: [] })).not.toThrow();
  });

  it("omits the activity type from the stats line when unset", () => {
    const svg = buildOgSvg({ ...BASE_ROUTE, activityType: null });
    // "Hike" only appears in the title/description path, not injected as a stat.
    const statsMatch = svg.match(/font-size="26"[^>]*>([^<]*)</);
    expect(statsMatch?.[1]).not.toContain("Hike");
  });
});
