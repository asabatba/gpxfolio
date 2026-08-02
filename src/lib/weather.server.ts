/**
 * Hourly forecasts from MET Norway's Locationforecast API (the data behind
 * yr.no). Global coverage, free, no API key — but usage terms require an
 * identifying User-Agent and require the client to cache and respect the
 * response's `Expires` header rather than re-polling. Both are handled here,
 * in a process-local in-memory cache: this app runs as a single server
 * process, forecasts are only valid for a couple of hours anyway, and a cold
 * cache after a restart just costs one extra request per location, not a
 * correctness problem.
 *
 * https://api.met.no/weatherapi/locationforecast/2.0/documentation
 */

const ENDPOINT = "https://api.met.no/weatherapi/locationforecast/2.0/compact";

/**
 * MET Norway asks integrators not to send more location precision than the
 * forecast actually resolves (a few hundred metres at best), both to protect
 * their servers and because it multiplies cache misses for no real benefit.
 * ~110 m at the equator, and it's the unit our cache keys on.
 */
const COORD_GRID = 1000;

/** Used only if the response has no (or an unparsable) `Expires` header. */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

function roundCoord(value: number): number {
  return Math.round(value * COORD_GRID) / COORD_GRID;
}

interface InstantDetails {
  air_temperature?: number;
  wind_speed?: number;
  wind_from_direction?: number;
  relative_humidity?: number;
}

interface ForecastBlock {
  summary?: { symbol_code?: string };
  details?: { precipitation_amount?: number };
}

interface TimeseriesEntry {
  time: string;
  data: {
    instant: { details: InstantDetails };
    next_1_hours?: ForecastBlock;
    next_6_hours?: ForecastBlock;
    next_12_hours?: ForecastBlock;
  };
}

interface LocationforecastResponse {
  properties: { timeseries: TimeseriesEntry[] };
}

interface CacheEntry {
  expiresAt: number;
  timeseries: TimeseriesEntry[];
}

const cache = new Map<string, CacheEntry>();

function userAgent(): string {
  const contact = process.env.WEATHER_CONTACT ?? process.env.PUBLIC_SITE_URL ?? "no-contact-configured";
  return `gpx-share (${contact})`;
}

async function fetchTimeseries(lat: number, lon: number): Promise<TimeseriesEntry[]> {
  const gridLat = roundCoord(lat);
  const gridLon = roundCoord(lon);
  const key = `${gridLat},${gridLon}`;

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.timeseries;

  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?lat=${gridLat}&lon=${gridLon}`, {
      headers: { "User-Agent": userAgent() },
    });
  } catch (error) {
    if (cached) return cached.timeseries; // Serve stale data over nothing if the network hiccups.
    throw error;
  }

  if (!response.ok) {
    if (cached) return cached.timeseries;
    throw new Error(`yr.no request failed: ${response.status} ${response.statusText}`);
  }

  const expiresHeader = response.headers.get("expires");
  const parsedExpiry = expiresHeader ? Date.parse(expiresHeader) : NaN;
  const expiresAt = Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + DEFAULT_TTL_MS;

  const body = (await response.json()) as LocationforecastResponse;
  const timeseries = body.properties.timeseries;
  cache.set(key, { expiresAt, timeseries });
  return timeseries;
}

/** The timeseries entry closest to `timestamp` — whatever resolution yr.no actually has there. */
function nearestEntry(timeseries: TimeseriesEntry[], timestamp: number): TimeseriesEntry | null {
  let best: TimeseriesEntry | null = null;
  let bestDeltaMs = Infinity;
  for (const entry of timeseries) {
    const deltaMs = Math.abs(Date.parse(entry.time) - timestamp);
    if (deltaMs < bestDeltaMs) {
      bestDeltaMs = deltaMs;
      best = entry;
    }
  }
  return best;
}

/** Prefers the finest-grained forecast block available for this entry. */
function blockOf(entry: TimeseriesEntry): ForecastBlock | undefined {
  return entry.data.next_1_hours ?? entry.data.next_6_hours ?? entry.data.next_12_hours;
}

export interface WeatherPoint {
  /** Epoch ms of the actual forecast entry used, which may not exactly match the request. */
  timestamp: number;
  temperatureC: number | null;
  windSpeedMps: number | null;
  precipitationMm: number | null;
  symbolCode: string | null;
}

async function getWeatherAt(lat: number, lon: number, timestamp: number): Promise<WeatherPoint | null> {
  const timeseries = await fetchTimeseries(lat, lon);
  const entry = nearestEntry(timeseries, timestamp);
  if (!entry) return null;

  const block = blockOf(entry);
  return {
    timestamp: Date.parse(entry.time),
    temperatureC: entry.data.instant.details.air_temperature ?? null,
    windSpeedMps: entry.data.instant.details.wind_speed ?? null,
    precipitationMm: block?.details?.precipitation_amount ?? null,
    symbolCode: block?.summary?.symbol_code ?? null,
  };
}

export interface WeatherRequestPoint {
  lat: number;
  lon: number;
  timestamp: number;
}

/**
 * Resolves each point independently so one failed/slow location never blanks
 * the rest of the plan's weather — a marker whose lookup fails just comes
 * back null and the client shows it as unavailable.
 */
export async function getWeatherForPoints(
  points: WeatherRequestPoint[],
): Promise<Array<WeatherPoint | null>> {
  return Promise.all(
    points.map((point) =>
      getWeatherAt(point.lat, point.lon, point.timestamp).catch(() => null),
    ),
  );
}
