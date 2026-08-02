/**
 * MET Norway's official weather icon set (the same icons yr.no itself uses),
 * vendored into `public/weather-icons/` from https://github.com/metno/weathericons
 * (MIT-licensed, see the LICENSE file in that directory). File names match
 * `symbol_code` exactly, so a forecast's code maps straight to an icon file
 * with no re-interpretation.
 *
 * Markup is returned as a raw HTML string, not a Solid component: map markers
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

const FAMILY_LABELS: Record<WeatherFamily, string> = {
  clear: "clear sky",
  partlyCloudy: "partly cloudy",
  cloudy: "cloudy",
  rain: "rain",
  sleet: "sleet",
  snow: "snow",
  thunder: "thunderstorms",
  fog: "fog",
};

/** Plain-text condition, for a marker's `aria-label` — the icon has no text alternative on its own. */
export function weatherFamilyLabel(symbolCode: string | null): string {
  return FAMILY_LABELS[classifySymbol(symbolCode).family];
}

/**
 * Every `symbol_code` the vendored icon set has a file for (the contents of
 * `public/weather-icons/`, minus the `.svg` extension). MET's API can in
 * principle return a code outside this list as its set evolves, so lookups
 * fall back to a neutral "cloudy" icon rather than a broken `<img>`.
 */
const KNOWN_SYMBOL_CODES = new Set([
  "clearsky_day", "clearsky_night", "clearsky_polartwilight",
  "cloudy",
  "fair_day", "fair_night", "fair_polartwilight",
  "fog",
  "heavyrain", "heavyrainandthunder",
  "heavyrainshowers_day", "heavyrainshowers_night", "heavyrainshowers_polartwilight",
  "heavyrainshowersandthunder_day", "heavyrainshowersandthunder_night", "heavyrainshowersandthunder_polartwilight",
  "heavysleet", "heavysleetandthunder",
  "heavysleetshowers_day", "heavysleetshowers_night", "heavysleetshowers_polartwilight",
  "heavysleetshowersandthunder_day", "heavysleetshowersandthunder_night", "heavysleetshowersandthunder_polartwilight",
  "heavysnow", "heavysnowandthunder",
  "heavysnowshowers_day", "heavysnowshowers_night", "heavysnowshowers_polartwilight",
  "heavysnowshowersandthunder_day", "heavysnowshowersandthunder_night", "heavysnowshowersandthunder_polartwilight",
  "lightrain", "lightrainandthunder",
  "lightrainshowers_day", "lightrainshowers_night", "lightrainshowers_polartwilight",
  "lightrainshowersandthunder_day", "lightrainshowersandthunder_night", "lightrainshowersandthunder_polartwilight",
  "lightsleet", "lightsleetandthunder",
  "lightsleetshowers_day", "lightsleetshowers_night", "lightsleetshowers_polartwilight",
  "lightsnow", "lightsnowandthunder",
  "lightsnowshowers_day", "lightsnowshowers_night", "lightsnowshowers_polartwilight",
  "lightssleetshowersandthunder_day", "lightssleetshowersandthunder_night", "lightssleetshowersandthunder_polartwilight",
  "lightssnowshowersandthunder_day", "lightssnowshowersandthunder_night", "lightssnowshowersandthunder_polartwilight",
  "partlycloudy_day", "partlycloudy_night", "partlycloudy_polartwilight",
  "rain", "rainandthunder",
  "rainshowers_day", "rainshowers_night", "rainshowers_polartwilight",
  "rainshowersandthunder_day", "rainshowersandthunder_night", "rainshowersandthunder_polartwilight",
  "sleet", "sleetandthunder",
  "sleetshowers_day", "sleetshowers_night", "sleetshowers_polartwilight",
  "sleetshowersandthunder_day", "sleetshowersandthunder_night", "sleetshowersandthunder_polartwilight",
  "snow", "snowandthunder",
  "snowshowers_day", "snowshowers_night", "snowshowers_polartwilight",
  "snowshowersandthunder_day", "snowshowersandthunder_night", "snowshowersandthunder_polartwilight",
]);

const FALLBACK_ICON = "cloudy";

/** `symbolCode` may be null while a marker's weather is still loading or unavailable. */
export function weatherIconMarkup(symbolCode: string | null): string {
  const icon = symbolCode != null && KNOWN_SYMBOL_CODES.has(symbolCode) ? symbolCode : FALLBACK_ICON;
  return `<img src="/weather-icons/${icon}.svg" width="20" height="20" alt="" aria-hidden="true">`;
}
