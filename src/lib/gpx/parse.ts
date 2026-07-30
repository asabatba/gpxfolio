import { XMLParser } from "fast-xml-parser";
import { GpxParseError, type GpxPoint, type GpxTrack, type ParsedGpx } from "./types";

/**
 * fast-xml-parser config notes:
 * - `isArray` forces the repeated containers to arrays so we never have to
 *   branch on "one child vs many", which is the usual source of GPX parser bugs.
 * - attribute values stay strings; we parse lat/lon ourselves to reject NaN.
 * - namespace prefixes are stripped (`removeNSPrefix`) so `gpxtpx:hr`, `ns3:hr`
 *   and plain `hr` all land on the same key. Exporters disagree wildly here.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name, jpath) =>
    jpath === "gpx.trk" ||
    jpath === "gpx.trk.trkseg" ||
    jpath === "gpx.trk.trkseg.trkpt" ||
    jpath === "gpx.rte" ||
    jpath === "gpx.rte.rtept",
});

type XmlNode = Record<string, unknown>;

function asArray(value: unknown): XmlNode[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]) as XmlNode[];
}

function text(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  // A tag carrying both attributes and text becomes an object with `#text`.
  if (typeof value === "object" && "#text" in (value as XmlNode)) {
    const inner = (value as XmlNode)["#text"];
    return typeof inner === "string" ? inner : undefined;
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  const raw = text(value);
  if (raw == null || raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestamp(value: unknown): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Heart rate lives at `extensions > TrackPointExtension > hr` for Garmin, but
 * some tools flatten it to `extensions > hr`. Both are cheap to check.
 */
function heartRate(extensions: unknown): number | undefined {
  if (extensions == null || typeof extensions !== "object") return undefined;
  const ext = extensions as XmlNode;
  const direct = num(ext["hr"]);
  if (direct != null) return direct;
  const tpe = ext["TrackPointExtension"];
  if (tpe != null && typeof tpe === "object") {
    return num((tpe as XmlNode)["hr"]);
  }
  return undefined;
}

function readPoint(node: XmlNode): GpxPoint | null {
  const lat = Number(node["@_lat"]);
  const lon = Number(node["@_lon"]);
  // Silently skipping malformed points is the right call: a single corrupt
  // trackpoint shouldn't cost the user a whole ride.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const point: GpxPoint = { lat, lon };
  const ele = num(node["ele"]);
  // Reject obviously bogus elevations (below the Dead Sea, above the stratosphere).
  if (ele != null && ele > -500 && ele < 12000) point.ele = ele;
  const time = timestamp(node["time"]);
  if (time != null) point.time = time;
  const hr = heartRate(node["extensions"]);
  if (hr != null && hr > 0 && hr < 260) point.hr = hr;
  return point;
}

/**
 * Parses a GPX document into tracks of full-resolution points.
 *
 * Segments within a `<trk>` are concatenated into one point list — a pause in
 * recording then shows up as a time gap, which {@link computeStats} already
 * handles as "not moving". Files with only `<rte>` (planned routes, no track)
 * fall back to route points so hand-built routes from planners still work.
 */
export function parseGpx(xml: string): ParsedGpx {
  if (!xml.trim()) throw new GpxParseError("The file is empty.");

  let doc: XmlNode;
  try {
    doc = parser.parse(xml) as XmlNode;
  } catch (cause) {
    throw new GpxParseError(
      `The file is not valid XML: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const gpx = doc["gpx"] as XmlNode | undefined;
  if (!gpx) throw new GpxParseError("No <gpx> root element found — is this really a GPX file?");

  const tracks: GpxTrack[] = [];

  for (const trk of asArray(gpx["trk"])) {
    const points: GpxPoint[] = [];
    for (const seg of asArray(trk["trkseg"])) {
      for (const node of asArray(seg["trkpt"])) {
        const point = readPoint(node);
        if (point) points.push(point);
      }
    }
    if (points.length >= 2) {
      tracks.push({ name: text(trk["name"]), points });
    }
  }

  // Only fall back to <rte> when there were no usable tracks at all.
  if (tracks.length === 0) {
    for (const rte of asArray(gpx["rte"])) {
      const points: GpxPoint[] = [];
      for (const node of asArray(rte["rtept"])) {
        const point = readPoint(node);
        if (point) points.push(point);
      }
      if (points.length >= 2) {
        tracks.push({ name: text(rte["name"]), points });
      }
    }
  }

  if (tracks.length === 0) {
    throw new GpxParseError(
      "No track with at least two points was found. The file may contain only waypoints.",
    );
  }

  const metadata = gpx["metadata"] as XmlNode | undefined;
  const result: ParsedGpx = { tracks };
  const name = (metadata && text(metadata["name"])) ?? tracks[0]?.name;
  if (name) result.name = name;
  const time = metadata && timestamp(metadata["time"]);
  if (time != null) result.time = time;
  return result;
}
