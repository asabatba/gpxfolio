/**
 * Presentation helpers. The database stores SI units throughout (metres,
 * seconds, m/s); every unit choice a viewer sees is made here.
 */

export type UnitSystem = "metric" | "imperial";

const KM_PER_MILE = 1.609344;
const M_PER_FOOT = 0.3048;

export function formatDistance(metres: number, units: UnitSystem = "metric"): string {
  if (units === "imperial") {
    const miles = metres / 1000 / KM_PER_MILE;
    return `${miles.toLocaleString(undefined, {
      minimumFractionDigits: miles < 100 ? 1 : 0,
      maximumFractionDigits: miles < 100 ? 1 : 0,
    })} mi`;
  }
  const km = metres / 1000;
  return `${km.toLocaleString(undefined, {
    minimumFractionDigits: km < 100 ? 1 : 0,
    maximumFractionDigits: km < 100 ? 1 : 0,
  })} km`;
}

export function formatElevation(metres: number, units: UnitSystem = "metric"): string {
  const value = units === "imperial" ? metres / M_PER_FOOT : metres;
  const suffix = units === "imperial" ? "ft" : "m";
  return `${Math.round(value).toLocaleString()} ${suffix}`;
}

export function formatSpeed(mps: number, units: UnitSystem = "metric"): string {
  if (units === "imperial") {
    return `${(mps * 3.6 / KM_PER_MILE).toFixed(1)} mph`;
  }
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

/**
 * Pace, the useful figure for running and hiking. Speed is the useful figure
 * for cycling, so both are offered and the route page picks by activity type.
 */
export function formatPace(mps: number, units: UnitSystem = "metric"): string {
  if (mps <= 0) return "—";
  const secondsPerUnit = units === "imperial" ? (1000 * KM_PER_MILE) / mps : 1000 / mps;
  const minutes = Math.floor(secondsPerUnit / 60);
  const seconds = Math.round(secondsPerUnit % 60);
  // Rounding 59.6s must roll over into the next minute, not print ":60".
  const carried = seconds === 60 ? { m: minutes + 1, s: 0 } : { m: minutes, s: seconds };
  return `${carried.m}:${String(carried.s).padStart(2, "0")} /${units === "imperial" ? "mi" : "km"}`;
}

/** Compact duration: `3h 12m`, or `48m 20s` when under an hour. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatDateShort(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** `1,234` — used for point counts in the upload summary. */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
