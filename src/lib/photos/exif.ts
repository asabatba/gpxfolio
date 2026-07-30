// exifr ships a CJS/UMD bundle; Vite's dev SSR module runner can't statically
// detect named exports on it (unlike vitest's transform or Rollup's production
// bundling, which both handle this fine), so the default-import + destructure
// form is what actually works across all three environments.
import exifr from "exifr";
const { gps, parse } = exifr;

/**
 * Normalized EXIF facts this app cares about, read from an uploaded photo.
 *
 * Every timestamp field here is deliberately kept as either a raw local
 * component breakdown (`naiveDateTimeOriginal`) or an already-unambiguous UTC
 * value (`gpsUtcMs`) — never a `Date` built by exifr's own revival, which
 * constructs its `Date` in a way that depends on the *server process's* local
 * timezone. That would make photo placement depend on `TZ` in the container
 * running this code, which has nothing to do with the timezone the photo was
 * actually taken in. `parse()` below is called with `reviveValues: false` for
 * exactly this reason, and every date is assembled by hand with `Date.UTC`.
 */
export interface PhotoExif {
  /** Epoch ms if `DateTimeOriginal`'s Y-M-D-H-M-S components were UTC — they are not; caller must correct. */
  naiveDateTimeOriginal: number | null;
  /** Minutes east of UTC, from `OffsetTimeOriginal` (EXIF 2.31+), e.g. "+02:00" -> 120. Rare but authoritative. */
  offsetMinutes: number | null;
  /** True UTC epoch ms from the camera's GPS fix (`GPSDateStamp`/`GPSTimeStamp`), independent of the camera clock. */
  gpsUtcMs: number | null;
  lat: number | null;
  lon: number | null;
}

const EMPTY: PhotoExif = {
  naiveDateTimeOriginal: null,
  offsetMinutes: null,
  gpsUtcMs: null,
  lat: null,
  lon: null,
};

/** "YYYY:MM:DD HH:mm:ss" (EXIF's date separator is `:`, even for the date part). */
function parseNaiveDateTime(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})\s(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as unknown as number[];
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

/** "+02:00" / "-05:30" -> minutes. */
function parseOffsetMinutes(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, sign, h, m] = match;
  const minutes = Number(h) * 60 + Number(m);
  return sign === "-" ? -minutes : minutes;
}

/** `GPSDateStamp` "YYYY:MM:DD" + `GPSTimeStamp` `[h, m, s]`, both already UTC. */
function parseGpsUtc(dateStamp: unknown, timeStamp: unknown): number | null {
  if (typeof dateStamp !== "string" || !Array.isArray(timeStamp)) return null;
  const dateMatch = dateStamp.match(/^(\d{4}):(\d{2}):(\d{2})$/);
  if (!dateMatch) return null;
  const [, y, mo, d] = dateMatch.map(Number) as unknown as number[];
  const [h, mi, s] = timeStamp as number[];
  if (![h, mi, s].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return Date.UTC(y, mo - 1, d, h, mi, Math.floor(s));
}

/**
 * Reads the EXIF tags this app needs from a photo's raw bytes.
 *
 * Two exifr calls: `gps()` for lat/lon (it does its own hemisphere-sign
 * correction internally), and `parse()` with an explicit `pick` list for the
 * timestamp-related tags, requested as raw strings/arrays rather than revived
 * `Date`s (see the module doc-comment for why).
 */
export async function readPhotoExif(bytes: Buffer): Promise<PhotoExif> {
  const [coords, tags] = await Promise.all([
    gps(bytes).catch(() => undefined),
    parse(bytes, {
      pick: ["DateTimeOriginal", "OffsetTimeOriginal", "GPSDateStamp", "GPSTimeStamp"],
      reviveValues: false,
    }).catch(() => undefined),
  ]);

  return {
    ...EMPTY,
    naiveDateTimeOriginal: parseNaiveDateTime(tags?.DateTimeOriginal),
    offsetMinutes: parseOffsetMinutes(tags?.OffsetTimeOriginal),
    gpsUtcMs: parseGpsUtc(tags?.GPSDateStamp, tags?.GPSTimeStamp),
    lat: coords?.latitude ?? null,
    lon: coords?.longitude ?? null,
  };
}
