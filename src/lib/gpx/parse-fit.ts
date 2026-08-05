import { Decoder, Stream, type FitMessages } from "@garmin/fitsdk";
import { GpxParseError, type GpxPoint, type ParsedGpx } from "./types";

// Field/message names below are camelCase (`recordMesgs`, `positionLat`, ...)
// per this installed SDK version's own type declarations
// (node_modules/@garmin/fitsdk/src/types/mesgs.d.ts) — the SDK's own hosted
// docs describe an older snake_case surface (`messages.record`,
// `position_lat`) that doesn't match what's actually installed.

/**
 * Parses a Garmin .fit activity file into the exact same shape `parseGpx`
 * returns, so every downstream consumer — denoise, stats, simplify, the
 * upload preview — works identically regardless of which format was
 * uploaded. Used both client-side (the upload preview) and server-side (via
 * {@link fitToGpxXml}, which also serializes the result back to GPX text for
 * storage — see that function's doc for why).
 *
 * A .fit activity is one continuous recording — unlike GPX, there's no
 * concept of several named `<trk>` elements — so this always yields exactly
 * one track, built from the file's `record` messages (one per sampled
 * point). Laps/sessions are summary messages, not extra points, so they're
 * not read here.
 */

/**
 * 1 semicircle = 180 / 2^31 degrees — the FIT protocol's fixed unit for
 * `position_lat`/`position_long`. The decoder's `applyScaleAndOffset` only
 * applies a field's *declared* scale/offset, and position has neither in the
 * FIT profile (only a unit), so this conversion has to happen by hand.
 */
const SEMICIRCLE_TO_DEGREES = 180 / 2 ** 31;

export function parseFit(bytes: Uint8Array): ParsedGpx {
  const stream = Stream.fromByteArray(bytes);

  if (!Decoder.isFIT(stream)) {
    throw new GpxParseError("This doesn't look like a Garmin .fit file.");
  }

  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) {
    throw new GpxParseError("This .fit file failed its integrity check — it may be corrupted.");
  }

  let messages: FitMessages;
  try {
    ({ messages } = decoder.read({
      applyScaleAndOffset: true,
      convertDateTimesToDates: true,
      convertTypesToStrings: true,
    }));
  } catch (cause) {
    throw new GpxParseError(
      `Couldn't read this .fit file: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const points: GpxPoint[] = [];
  for (const record of messages.recordMesgs ?? []) {
    const rawLat = record.positionLat;
    const rawLon = record.positionLong;
    if (typeof rawLat !== "number" || typeof rawLon !== "number") continue; // No GPS fix at this sample.

    const lat = rawLat * SEMICIRCLE_TO_DEGREES;
    const lon = rawLon * SEMICIRCLE_TO_DEGREES;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const point: GpxPoint = { lat, lon };

    const ele = record.enhancedAltitude ?? record.altitude;
    if (typeof ele === "number" && ele > -500 && ele < 12000) point.ele = ele;

    if (record.timestamp instanceof Date) point.time = record.timestamp.getTime();

    if (typeof record.heartRate === "number" && record.heartRate > 0 && record.heartRate < 260) {
      point.hr = record.heartRate;
    }

    points.push(point);
  }

  if (points.length < 2) {
    throw new GpxParseError(
      "No usable GPS track was found in this .fit file — it may be an indoor/trainer activity with no position data.",
    );
  }

  return { tracks: [{ points }] };
}

/** No free text anywhere in a FIT-sourced point (unlike a GPX title), so no XML-escaping is needed. */
function serializeAsGpx(points: GpxPoint[]): string {
  const trkpts = points
    .map((p) => {
      const parts = [`<trkpt lat="${p.lat}" lon="${p.lon}">`];
      if (p.ele != null) parts.push(`<ele>${p.ele}</ele>`);
      if (p.time != null) parts.push(`<time>${new Date(p.time).toISOString()}</time>`);
      if (p.hr != null) {
        parts.push(
          `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`,
        );
      }
      parts.push("</trkpt>");
      return parts.join("");
    })
    .join("\n      ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gpxfolio"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <trkseg>
      ${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

/**
 * Converts a .fit file straight to GPX XML text, for the server upload path.
 * Everything downstream of a file upload — `writeTrackGpx`'s storage,
 * `mergeGpx`'s textual `<trk>` extraction for "Download GPX" — is built
 * around GPX text, and re-deriving all of that for a second binary format
 * would be a lot of surface for a personal archive tool. Normalizing here,
 * once, at the upload boundary keeps every other file exactly as it is
 * today — the same trick the paste-a-URL import already uses (fetch
 * whatever, hand the same `{filename, xml}` shape to `createRoute`). The
 * cost: "Download GPX" for a .fit-sourced route returns this synthesized
 * file, not byte-identical to the original upload.
 */
export function fitToGpxXml(bytes: Uint8Array): string {
  const parsed = parseFit(bytes);
  return serializeAsGpx(parsed.tracks[0].points);
}
