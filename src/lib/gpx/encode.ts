/**
 * Google encoded polyline, precision 5 (~1.1 m quantisation at the equator).
 *
 * Chosen over a JSON coordinate array because it is roughly 4x smaller for the
 * same data and its quantisation error is well below our simplification
 * tolerance, so it costs no visible accuracy. Both sides of the app use these
 * two functions, which is why they live in their own module.
 */

const PRECISION = 5;
const FACTOR = 10 ** PRECISION;

function encodeSigned(value: number, out: string[]): void {
  let v = value < 0 ? ~(value << 1) : value << 1;
  while (v >= 0x20) {
    out.push(String.fromCharCode((0x20 | (v & 0x1f)) + 63));
    v >>= 5;
  }
  out.push(String.fromCharCode(v + 63));
}

/** `coords` is `[lat, lon]` pairs. */
export function encodePolyline(coords: Array<[number, number]>): string {
  const out: string[] = [];
  let prevLat = 0;
  let prevLon = 0;
  for (const [lat, lon] of coords) {
    // Round to the grid first, then diff the *rounded* values, so quantisation
    // error cannot accumulate along the line.
    const qLat = Math.round(lat * FACTOR);
    const qLon = Math.round(lon * FACTOR);
    encodeSigned(qLat - prevLat, out);
    encodeSigned(qLon - prevLon, out);
    prevLat = qLat;
    prevLon = qLon;
  }
  return out.join("");
}

/** Returns `[lat, lon]` pairs. */
export function decodePolyline(encoded: string): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lat / FACTOR, lon / FACTOR]);
  }

  return coords;
}

/** MapLibre wants `[lon, lat]`; GPX and polylines are `[lat, lon]`. */
export function toLngLat(coords: Array<[number, number]>): Array<[number, number]> {
  return coords.map(([lat, lon]) => [lon, lat]);
}
