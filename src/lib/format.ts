/**
 * Presentation helpers. The database stores SI units throughout (metres,
 * seconds, m/s); this module is the only place they get turned into display
 * strings. The site is metric-only.
 */

export function formatDistance(metres: number): string {
  const km = metres / 1000;
  // One decimal is useful up to 100 km; past that it's noise.
  const digits = km < 100 ? 1 : 0;
  return `${km.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} km`;
}

export function formatElevation(metres: number): string {
  return `${Math.round(metres).toLocaleString()} m`;
}

export function formatSpeed(mps: number): string {
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

/**
 * Pace, the useful figure for running and hiking. Speed is the useful figure for
 * cycling, so both exist and the route page picks by activity type.
 */
export function formatPace(mps: number): string {
  if (mps <= 0) return "—";
  const secondsPerKm = 1000 / mps;
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  // Rounding 59.6s must roll over into the next minute, not print ":60".
  const carried = seconds === 60 ? { m: minutes + 1, s: 0 } : { m: minutes, s: seconds };
  return `${carried.m}:${String(carried.s).padStart(2, "0")} /km`;
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

/** `14:32` — used for the per-photo timestamp in the time-sync UI. */
export function formatTime(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
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
