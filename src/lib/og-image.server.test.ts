import { describe, expect, it } from "vitest";
import { encodePolyline } from "./gpx/encode";
import { renderRouteOgImage } from "./og-image.server";

describe("renderRouteOgImage", () => {
  it("rasterises the SVG to a valid PNG via sharp", async () => {
    const png = await renderRouteOgImage({
      title: "Smoke Test Route",
      activityType: "Ride",
      distanceM: 10_000,
      elevationGainM: 200,
      startedAt: new Date(),
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
    });

    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.byteLength).toBeGreaterThan(1000);
  });
});
