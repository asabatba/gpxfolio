import { query } from "@solidjs/router";
import type { WeatherPoint, WeatherRequestPoint } from "./weather.server";

export type { WeatherPoint, WeatherRequestPoint };

/**
 * Fetches weather for every hourly sample point in one round trip. The server
 * side (`weather.server.ts`) resolves each point independently and caches by
 * location, so this stays cheap to call again as the visitor adjusts the plan.
 */
export const getWeatherForPoints = query(async (points: WeatherRequestPoint[]) => {
  "use server";
  const { getWeatherForPoints: fetchAll } = await import("./weather.server");
  return fetchAll(points);
}, "weatherForPoints");

export type WeatherResult = Awaited<ReturnType<typeof getWeatherForPoints>>;
