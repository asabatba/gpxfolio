import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGpx } from "./parse";
import { GpxParseError } from "./types";

const fixture = readFileSync(
  fileURLToPath(new URL("../../../test/fixtures/sample.gpx", import.meta.url)),
  "utf8",
);

describe("parseGpx", () => {
  it("reads metadata, and concatenates segments into one point list", () => {
    const gpx = parseGpx(fixture);
    expect(gpx.name).toBe("Test Loop");
    expect(gpx.time).toBe(Date.parse("2024-05-18T07:00:00Z"));
    expect(gpx.tracks).toHaveLength(1);
    // 3 points in the first segment + 2 in the second.
    expect(gpx.tracks[0].points).toHaveLength(5);
    expect(gpx.tracks[0].name).toBe("Morning ride");
  });

  it("reads lat/lon, elevation, time and namespaced heart rate", () => {
    const [track] = parseGpx(fixture).tracks;
    const first = track.points[0];
    expect(first.lat).toBeCloseTo(42.5, 6);
    expect(first.lon).toBeCloseTo(1.5, 6);
    expect(first.ele).toBe(1000);
    expect(first.time).toBe(Date.parse("2024-05-18T07:00:00Z"));
    // `removeNSPrefix` means gpxtpx:hr, ns3:hr and hr all resolve.
    expect(first.hr).toBe(112);
    // Points without an <extensions> block simply have no hr.
    expect(track.points[2].hr).toBeUndefined();
  });

  it("handles a single trkpt child without treating it as a character array", () => {
    const gpx = parseGpx(`<?xml version="1.0"?>
      <gpx version="1.1"><trk><trkseg>
        <trkpt lat="10" lon="20"><ele>5</ele></trkpt>
        <trkpt lat="10.001" lon="20"><ele>6</ele></trkpt>
      </trkseg></trk></gpx>`);
    expect(gpx.tracks[0].points).toHaveLength(2);
    expect(gpx.tracks[0].points[1].lat).toBeCloseTo(10.001, 6);
  });

  it("falls back to <rte> when the file has no track", () => {
    const gpx = parseGpx(`<?xml version="1.0"?>
      <gpx version="1.1"><rte><name>Planned</name>
        <rtept lat="1" lon="2"/><rtept lat="1.01" lon="2.01"/>
      </rte></gpx>`);
    expect(gpx.tracks).toHaveLength(1);
    expect(gpx.tracks[0].name).toBe("Planned");
    expect(gpx.tracks[0].points).toHaveLength(2);
  });

  it("skips individual malformed points rather than failing the whole file", () => {
    const gpx = parseGpx(`<?xml version="1.0"?>
      <gpx version="1.1"><trk><trkseg>
        <trkpt lat="10" lon="20"/>
        <trkpt lat="not-a-number" lon="20"/>
        <trkpt lat="999" lon="20"/>
        <trkpt lat="10.001" lon="20"/>
      </trkseg></trk></gpx>`);
    expect(gpx.tracks[0].points).toHaveLength(2);
  });

  it("ignores physically impossible elevations", () => {
    const gpx = parseGpx(`<?xml version="1.0"?>
      <gpx version="1.1"><trk><trkseg>
        <trkpt lat="10" lon="20"><ele>-99999</ele></trkpt>
        <trkpt lat="10.001" lon="20"><ele>500</ele></trkpt>
      </trkseg></trk></gpx>`);
    expect(gpx.tracks[0].points[0].ele).toBeUndefined();
    expect(gpx.tracks[0].points[1].ele).toBe(500);
  });

  it("throws a typed error for empty, non-GPX and waypoint-only files", () => {
    expect(() => parseGpx("")).toThrow(GpxParseError);
    expect(() => parseGpx("<html><body>nope</body></html>")).toThrow(GpxParseError);
    expect(() =>
      parseGpx(`<?xml version="1.0"?><gpx version="1.1"><wpt lat="1" lon="2"/></gpx>`),
    ).toThrow(GpxParseError);
  });
});
