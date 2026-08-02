import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { formatDuration, formatTimeInZone } from "~/lib/format";
import {
  buildHourlySamples,
  buildSchedule,
  defaultPlanStart,
  fromDatetimeLocalValue,
  maxPlanStart,
  STRETCH_MAX,
  STRETCH_MIN,
  timezoneAt,
  toDatetimeLocalValue,
  type HourlySample,
  type Schedule,
} from "~/lib/planning";
import type { TrackView } from "~/lib/track-view";
import { getWeatherForPoints, type WeatherPoint } from "~/lib/weather-query";

export interface WeatherMarkerView {
  hourIndex: number;
  distanceM: number;
  lat: number;
  lon: number;
  timestamp: number;
  coarse: boolean;
  status: "loading" | "ready" | "unavailable";
  temperatureC: number | null;
  windSpeedMps: number | null;
  precipitationMm: number | null;
  symbolCode: string | null;
}

export interface PlanState {
  schedule: Schedule | null;
  markers: WeatherMarkerView[];
  timeZone: string;
}

interface RoutePlannerProps {
  track: TrackView;
  onChange: (state: PlanState) => void;
}

/** How long to wait after the last slider/date change before hitting the network. */
const WEATHER_DEBOUNCE_MS = 400;

/**
 * "Plan this hike for a different day": pick a start date/time and stretch or
 * compress the total duration, then look up hourly weather along the
 * resulting schedule. Collapsed by default; expanding it drives the map's
 * weather markers and the elevation profile's arrival-time readout via
 * `onChange` (see `r/[slug].tsx`).
 */
export default function RoutePlanner(props: RoutePlannerProps) {
  // A signal, not a plain `let`: the input only exists once `<Show when={open()}>`
  // mounts it, and the effect below needs to re-run at that point — a plain
  // ref variable is invisible to reactivity, so the effect would only ever see
  // it as `undefined` (it runs once, before the ref callback ever fires).
  const [startInput, setStartInput] = createSignal<HTMLInputElement>();

  const timeZone = createMemo(() => {
    const [lon, lat] = props.track.coordinates[0];
    return timezoneAt(lat, lon);
  });

  const [open, setOpen] = createSignal(false);
  const [start, setStart] = createSignal<number | null>(null);
  const [stretch, setStretch] = createSignal(1);

  function reset() {
    setStart(defaultPlanStart(props.track, timeZone()));
    setStretch(1);
  }

  function toggle() {
    if (!open() && start() == null) reset();
    setOpen(!open());
  }

  const schedule = createMemo<Schedule | null>(() => {
    if (!open()) return null;
    const startMs = start();
    if (startMs == null) return null;
    return buildSchedule(props.track, startMs, stretch());
  });

  const samples = createMemo<HourlySample[]>(() => {
    const s = schedule();
    return s ? buildHourlySamples(props.track, s) : [];
  });

  // The schedule and map/elevation-profile positions above update instantly —
  // only the network lookup is debounced, so dragging the slider stays smooth
  // and doesn't fire a request per pixel.
  const [debounced, setDebounced] = createSignal<HourlySample[]>([]);
  createEffect(() => {
    const list = samples();
    const timer = setTimeout(() => setDebounced(list), WEATHER_DEBOUNCE_MS);
    onCleanup(() => clearTimeout(timer));
  });

  // Fetched by hand rather than `createAsync`: that resource is Suspense-integrated,
  // and this component lives inside the route page's <Suspense> — every re-fetch
  // (i.e. every debounced slider/date change) would suspend the *entire page*
  // back to its "Loading route…" fallback, when only the weather markers should
  // show a loading state (see `markers` below).
  const [weather, setWeather] = createSignal<Array<WeatherPoint | null>>([]);
  createEffect(() => {
    const points = debounced();
    if (points.length === 0) {
      setWeather([]);
      return;
    }
    let cancelled = false;
    getWeatherForPoints(points.map((p) => ({ lat: p.lat, lon: p.lon, timestamp: p.timestamp })))
      .then((result) => {
        if (!cancelled) setWeather(result);
      })
      .catch(() => {
        if (!cancelled) setWeather(points.map(() => null));
      });
    onCleanup(() => {
      cancelled = true;
    });
  });

  const markers = createMemo<WeatherMarkerView[]>(() => {
    const list = samples();
    const results = weather();
    const debouncedList = debounced();
    const byHour = new Map(debouncedList.map((s, i) => [s.hourIndex, results?.[i]]));

    return list.map((s): WeatherMarkerView => {
      const result = byHour.get(s.hourIndex);
      if (result === undefined) {
        return {
          ...s,
          status: "loading",
          temperatureC: null,
          windSpeedMps: null,
          precipitationMm: null,
          symbolCode: null,
        };
      }
      if (result === null) {
        return {
          ...s,
          status: "unavailable",
          temperatureC: null,
          windSpeedMps: null,
          precipitationMm: null,
          symbolCode: null,
        };
      }
      return {
        ...s,
        status: "ready",
        temperatureC: result.temperatureC,
        windSpeedMps: result.windSpeedMps,
        precipitationMm: result.precipitationMm,
        symbolCode: result.symbolCode,
      };
    });
  });

  createEffect(() => {
    props.onChange({ schedule: schedule(), markers: markers(), timeZone: timeZone() });
  });

  // Writing `.value` unconditionally on every keystroke (a naively "controlled"
  // input) makes Chromium and Firefox both drop focus out of the field the
  // moment an arrow key nudges the hour/minute — the browser resets the
  // control's internal editing state whenever `.value` is assigned, even to
  // the string it already holds. Only reassigning when the computed string
  // actually differs (e.g. the Reset button, or the initial mount) avoids
  // fighting the browser while the user is mid-edit.
  createEffect(() => {
    const el = startInput();
    const value = start() != null ? toDatetimeLocalValue(start() as number, timeZone()) : "";
    if (el && el.value !== value) el.value = value;
  });

  return (
    <section class="card mt-4 rounded-xl px-4 py-3">
      <button
        type="button"
        class="btn btn-secondary tap w-full justify-between"
        onClick={toggle}
        aria-expanded={open()}
      >
        <span>Plan this hike for a different day</span>
        <span aria-hidden="true">{open() ? "−" : "+"}</span>
      </button>

      <Show when={open()}>
        <div class="mt-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div>
            <label class="label" for="plan-start">
              Start
            </label>
            <input
              ref={setStartInput}
              id="plan-start"
              type="datetime-local"
              class="field"
              min={toDatetimeLocalValue(Date.now(), timeZone())}
              max={toDatetimeLocalValue(maxPlanStart(), timeZone())}
              onInput={(event) => {
                const parsed = fromDatetimeLocalValue(event.currentTarget.value, timeZone());
                if (parsed != null) setStart(parsed);
              }}
            />
            <p class="ink-muted mt-1 text-xs">Local time at the trailhead ({timeZone()})</p>
          </div>

          <div class="min-w-[240px] flex-1">
            <label class="label" for="plan-stretch">
              Total hike time: {formatDuration(schedule()?.durationS ?? 0)} ({stretch().toFixed(2)}×
              original pace)
            </label>
            <input
              id="plan-stretch"
              type="range"
              min={STRETCH_MIN}
              max={STRETCH_MAX}
              step={0.05}
              value={stretch()}
              style={{ "accent-color": "var(--accent)", width: "100%" }}
              onInput={(event) => setStretch(Number(event.currentTarget.value))}
            />
          </div>

          <button type="button" class="btn btn-ghost" onClick={reset}>
            Reset
          </button>
        </div>

        <Show when={schedule()}>
          {(s) => (
            <p class="ink-muted mt-3 text-sm">
              Starting {formatTimeInZone(s().startMs, timeZone())}, finishing around{" "}
              {formatTimeInZone(s().startMs + s().durationS * 1000, timeZone())}.
            </p>
          )}
        </Show>
      </Show>
    </section>
  );
}
