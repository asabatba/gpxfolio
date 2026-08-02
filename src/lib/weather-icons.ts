/**
 * Hand-rolled weather icons, matching the app's dependency-free, hand-rolled
 * SVG aesthetic (see `ElevationProfile.tsx`) rather than pulling in MET
 * Norway's ~100-icon official set. A hiker glancing at a map marker only
 * needs to tell sun/cloud/rain/snow/storm/fog apart, not the full nuance of
 * every `symbol_code` MET returns.
 *
 * Markup is returned as a raw SVG string, not a Solid component: map markers
 * are plain DOM elements MapLibre owns directly (see `RouteMap.tsx`), outside
 * Solid's render tree.
 */

export type WeatherFamily =
  | "clear"
  | "partlyCloudy"
  | "cloudy"
  | "rain"
  | "sleet"
  | "snow"
  | "thunder"
  | "fog";

/** Coarse family + day/night for one of MET's `symbol_code` values. Order matters: check the more specific conditions first. */
export function classifySymbol(symbolCode: string | null): { family: WeatherFamily; isNight: boolean } {
  const code = symbolCode ?? "";
  const isNight = code.includes("_night") || code.includes("_polartwilight");

  let family: WeatherFamily;
  if (code.includes("thunder")) family = "thunder";
  else if (code.includes("sleet")) family = "sleet";
  else if (code.includes("snow")) family = "snow";
  else if (code.includes("rain")) family = "rain";
  else if (code.includes("fog")) family = "fog";
  else if (code.includes("partlycloudy")) family = "partlyCloudy";
  else if (code.includes("cloudy")) family = "cloudy";
  else if (code.includes("fair")) family = "partlyCloudy";
  else if (code.includes("clearsky")) family = "clear";
  else family = "cloudy"; // Unknown/missing code — a neutral cloud beats guessing wrong.

  return { family, isNight };
}

const SUN = (color: string) =>
  `<circle cx="12" cy="12" r="5" fill="${color}"/>` +
  [0, 45, 90, 135, 180, 225, 270, 315]
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const x1 = 12 + Math.cos(rad) * 8;
      const y1 = 12 + Math.sin(rad) * 8;
      const x2 = 12 + Math.cos(rad) * 10.5;
      const y2 = 12 + Math.sin(rad) * 10.5;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>`;
    })
    .join("");

const MOON = (color: string) =>
  `<path d="M15.5 4.5a8 8 0 1 0 4 12.9A9.5 9.5 0 0 1 15.5 4.5Z" fill="${color}"/>`;

const CLOUD = (color: string, y = 13) =>
  `<path d="M7 ${y + 4}a3.5 3.5 0 0 1 .3-7 4.6 4.6 0 0 1 8.8-1.3A3.8 3.8 0 0 1 17 ${y + 4}Z" fill="${color}"/>`;

const RAINDROPS = (color: string, y: number) =>
  [6.5, 12, 17.5]
    .map((x) => `<line x1="${x}" y1="${y}" x2="${x - 1.5}" y2="${y + 4}" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>`)
    .join("");

const SNOWFLAKES = (color: string, y: number) =>
  [6.5, 12, 17.5]
    .map((x) => `<circle cx="${x}" cy="${y + 2}" r="1.1" fill="${color}"/>`)
    .join("");

const BOLT = (color: string) =>
  `<path d="M13 12.5h-3.2l2.4-5.5-5.7 8h3.2l-2.4 5.5Z" fill="${color}"/>`;

/** `symbolCode` may be null while a marker's weather is still loading or unavailable. */
export function weatherIconMarkup(symbolCode: string | null): string {
  const { family, isNight } = classifySymbol(symbolCode);
  const sky = isNight ? "#8fa3c7" : "#f2a93b";
  const cloud = isNight ? "#c7d0e0" : "#9aa4b2";
  const wet = "#4c8fd9";

  let body: string;
  switch (family) {
    case "clear":
      body = isNight ? MOON(sky) : SUN(sky);
      break;
    case "partlyCloudy":
      body = (isNight ? MOON(sky) : SUN(sky)) + CLOUD(cloud, 14);
      break;
    case "cloudy":
      body = CLOUD(cloud, 12) + CLOUD(cloud, 15);
      break;
    case "rain":
      body = CLOUD(cloud, 9) + RAINDROPS(wet, 15);
      break;
    case "sleet":
      body = CLOUD(cloud, 9) + RAINDROPS(wet, 15) + SNOWFLAKES("#fff", 18);
      break;
    case "snow":
      body = CLOUD(cloud, 9) + SNOWFLAKES("#fff", 16);
      break;
    case "thunder":
      body = CLOUD(cloud, 9) + BOLT("#e8590c");
      break;
    case "fog":
      body = [7, 11, 15].map((y) => `<line x1="4" y1="${y}" x2="20" y2="${y}" stroke="${cloud}" stroke-width="1.8" stroke-linecap="round"/>`).join("");
      break;
  }

  return `<svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
}
