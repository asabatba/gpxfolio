import tzlookup from "tz-lookup";
import type { TrackView } from "./track-view";

/**
 * Pure client-safe math for "plan this hike for a different day": re-pacing a
 * recorded track to a new start time and stretched/compressed duration, and
 * sampling the resulting schedule for weather lookups. No network, no DOM —
 * this is the one place both the planning panel and the map/elevation
 * profile go to answer "where/when is the hiker at distance X".
 */

/** How far the stretch slider is allowed to move the original duration. */
export const STRETCH_MIN = 0.5;
export const STRETCH_MAX = 2;

/** yr.no's Locationforecast only covers this far ahead. */
export const MAX_PLAN_DAYS_AHEAD = 9;

/**
 * yr.no's own timeseries is hourly for roughly the first two days from *now*,
 * then drops to one point every six hours out to the edge of its 9-day
 * coverage. Sampling on the same cadence means a marker only ever appears
 * where there is genuinely distinct data behind it.
 */
const HOURLY_RESOLUTION_WINDOW_MS = 48 * 60 * 60 * 1000;
const COARSE_STEP_S = 6 * 3600;

/** Binary search for the segment of a monotonically non-decreasing array bracketing `target`. */
function segmentAt(xs: number[], target: number): { lo: number; hi: number; t: number } {
  const clamped = Math.max(xs[0], Math.min(xs[xs.length - 1], target));
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < clamped) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  return { lo, hi, t: span > 0 ? (clamped - xs[lo]) / span : 0 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolates `ys[i]` at the point where `xs[i] === targetX`, both index-aligned. */
function interpAt(xs: number[], ys: number[], targetX: number): number {
  const { lo, hi, t } = segmentAt(xs, targetX);
  return lerp(ys[lo], ys[hi], t);
}

/** Lat/lon at a distance along the track, interpolated between the bracketing recorded points. */
export function positionAtDistance(track: TrackView, distanceM: number): { lat: number; lon: number } {
  const { lo, hi, t } = segmentAt(track.distances, distanceM);
  const [lonA, latA] = track.coordinates[lo];
  const [lonB, latB] = track.coordinates[hi];
  return { lat: lerp(latA, latB, t), lon: lerp(lonA, lonB, t) };
}

export interface Schedule {
  startMs: number;
  /** Stretched/compressed total duration, seconds. */
  durationS: number;
  stretchFactor: number;
  /** Epoch ms the hiker is estimated to reach this distance. */
  arrivalAt(distanceM: number): number;
  /** Distance reached after this many seconds have elapsed since `startMs`. */
  distanceAtElapsed(elapsedS: number): number;
}

/**
 * Builds a schedule by linearly rescaling the track's own recorded pacing:
 * every point's original `timeOffset` is multiplied by `newDuration /
 * originalDuration`, so sections that took proportionally longer in the
 * original hike (a climb, a rest stop) still take proportionally longer here.
 *
 * Returns null for a track with no recorded timestamps — there is no original
 * pace to stretch, and inventing a generic one is a different feature.
 */
export function buildSchedule(
  track: TrackView,
  startMs: number,
  stretchFactor: number,
): Schedule | null {
  const timeOffsets = track.timeOffsets;
  if (!timeOffsets || timeOffsets.length < 2) return null;
  const originalDurationS = timeOffsets[timeOffsets.length - 1];
  if (!(originalDurationS > 0)) return null;

  const durationS = originalDurationS * stretchFactor;

  return {
    startMs,
    durationS,
    stretchFactor,
    arrivalAt(distanceM) {
      const originalS = interpAt(track.distances, timeOffsets, distanceM);
      return startMs + originalS * stretchFactor * 1000;
    },
    distanceAtElapsed(elapsedS) {
      const originalS = Math.max(0, Math.min(originalDurationS, elapsedS / stretchFactor));
      return interpAt(timeOffsets, track.distances, originalS);
    },
  };
}

export interface HourlySample {
  hourIndex: number;
  distanceM: number;
  lat: number;
  lon: number;
  /** Epoch ms this sample represents. */
  timestamp: number;
  /** True once this sample is beyond yr.no's hourly-resolution window. */
  coarse: boolean;
}

/**
 * One sample per hour of the schedule while within yr.no's ~48h hourly
 * window, then one per six hours beyond it — see `HOURLY_RESOLUTION_WINDOW_MS`.
 */
export function buildHourlySamples(track: TrackView, schedule: Schedule): HourlySample[] {
  const now = Date.now();
  const out: HourlySample[] = [];
  let elapsedS = 0;
  let hourIndex = 0;

  for (;;) {
    const timestamp = schedule.startMs + elapsedS * 1000;
    const coarse = timestamp - now > HOURLY_RESOLUTION_WINDOW_MS;
    const distanceM = schedule.distanceAtElapsed(elapsedS);
    const { lat, lon } = positionAtDistance(track, distanceM);
    out.push({ hourIndex, distanceM, lat, lon, timestamp, coarse });

    if (elapsedS >= schedule.durationS) break;
    const stepS = coarse ? COARSE_STEP_S : 3600;
    elapsedS = Math.min(schedule.durationS, elapsedS + stepS);
    hourIndex++;
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Timezones — planning is always in the trailhead's local time, never the   */
/* visitor's, so a hiker in another timezone still plans against sunrise and */
/* forecast times that make sense for the trail.                             */
/* -------------------------------------------------------------------------- */

/** IANA zone for a coordinate. Falls back to UTC over open ocean, where lookups miss. */
export function timezoneAt(lat: number, lon: number): string {
  try {
    return tzlookup(lat, lon);
  } catch {
    return "UTC";
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function partsInZone(utcMs: number, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/**
 * Epoch ms for a wall-clock date/time as observed in `timeZone`. One
 * correction pass: guess the offset from the naive UTC instant, then
 * re-derive from that — exact for standard time and for all but the repeated
 * hour during a DST fall-back, which is an acceptable edge case here.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute);
  const asIfUtc = partsInZone(guessUtc, timeZone);
  const observedUtc = Date.UTC(asIfUtc.year, asIfUtc.month - 1, asIfUtc.day, asIfUtc.hour, asIfUtc.minute);
  return guessUtc - (observedUtc - guessUtc);
}

/** `Y-M-DTHH:MM`, the format `<input type="datetime-local">` reads and writes. */
export function toDatetimeLocalValue(utcMs: number, timeZone: string): string {
  const { year, month, day, hour, minute } = partsInZone(utcMs, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/** Parses a `datetime-local` value as wall-clock time in `timeZone` — never the browser's own zone. */
export function fromDatetimeLocalValue(value: string, timeZone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  return zonedTimeToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), timeZone);
}

/**
 * Tomorrow, at the same local time-of-day the route was originally recorded —
 * a sensible default (an alpine route recorded at dawn defaults to a dawn
 * start) that's always within the forecast window.
 */
export function defaultPlanStart(track: TrackView, timeZone: string): number {
  const tomorrow = partsInZone(Date.now() + 24 * 3600 * 1000, timeZone);
  const recorded = partsInZone(track.startedAt ?? Date.now(), timeZone);
  return zonedTimeToUtc(tomorrow.year, tomorrow.month, tomorrow.day, recorded.hour, recorded.minute, timeZone);
}

/** Latest start instant the date picker should allow, given yr.no's forecast horizon. */
export function maxPlanStart(): number {
  return Date.now() + MAX_PLAN_DAYS_AHEAD * 24 * 3600 * 1000;
}
