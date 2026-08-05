import {
  GeolocateControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
} from "maplibre-gl";
import { createEffect, createSignal, onCleanup, onMount, Show, type Accessor } from "solid-js";
import MapSkeleton from "~/components/MapSkeleton";
import type { WeatherMarkerView } from "~/components/RoutePlanner";
import type { BBox } from "~/lib/gpx/types";
import { FALLBACK_STYLE, HIKING_STYLE } from "~/lib/map-style";
import { createOnlineSignal } from "~/lib/online-status";
import type { HoverPoint, PhotoView, TrackView } from "~/lib/track-view";
import { weatherFamilyLabel, weatherIconMarkup } from "~/lib/weather-icons";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * MapLibre v6 is ESM-only and imports are namespaced/named — there is no default
 * export. This component is loaded through `clientOnly()` by its callers so the
 * library never runs during SSR, where `window` does not exist.
 */

interface RouteMapProps {
  tracks: TrackView[];
  bbox: BBox | null;
  /** Point currently hovered on the elevation profile, marked on the map. */
  hovered: Accessor<HoverPoint | null>;
  /** Photos with a resolved position get a pin; others are omitted. */
  photos?: PhotoView[];
  onSelectPhoto?: (id: string) => void;
  /** Hourly weather along a "plan this hike" schedule, from `RoutePlanner`. Redrawn whenever it changes. */
  weatherMarkers?: Accessor<WeatherMarkerView[]>;
  /**
   * Ids of tracks the viewer has left checked in the Tracks list. Unchecked
   * tracks stay in `tracks` (the elevation profile still needs all of them)
   * but are hidden here, and don't count toward the start/finish pins.
   */
  visibleTrackIds: Accessor<Set<string>>;
  class?: string;
}

function weatherPopupHtml(marker: WeatherMarkerView): string {
  const temp = marker.temperatureC != null ? `${Math.round(marker.temperatureC)}°C` : "—";
  const time = new Date(marker.timestamp).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const details = [
    marker.windSpeedMps != null ? `${marker.windSpeedMps.toFixed(1)} m/s wind` : null,
    marker.precipitationMm != null ? `${marker.precipitationMm.toFixed(1)} mm precip` : null,
  ]
    .filter((part): part is string => part != null)
    .join(" · ");

  return (
    `<div style="font-size:12px;line-height:1.5;"><strong>${temp}</strong> ${time}` +
    (marker.coarse ? ` <span style="color:var(--ink-muted);">(6-hourly forecast)</span>` : "") +
    (details ? `<div style="color:var(--ink-muted);">${details}</div>` : "") +
    `</div>`
  );
}

/** Text alternative for a ready marker's icon+temperature, which otherwise has none. */
function weatherAriaLabel(marker: WeatherMarkerView): string {
  const temp = marker.temperatureC != null ? `${Math.round(marker.temperatureC)}°C` : "unknown temperature";
  const time = new Date(marker.timestamp).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const resolution = marker.coarse ? ", 6-hourly forecast" : "";
  return `Forecast: ${temp}, ${weatherFamilyLabel(marker.symbolCode)}, ${time}${resolution}`;
}

/**
 * Does the actual MapLibre work. Split out from `RouteMap` below so it's only
 * ever instantiated while online — `onMount` here fires at most once per
 * mount, so an offline→online transition needs a fresh instance (via
 * `<Show>` swapping this component in), not a signal this one could react to
 * mid-life.
 */
function MapCanvas(props: RouteMapProps) {
  let container!: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let hoverMarker: Marker | undefined;
  let startMarker: Marker | undefined;
  let finishMarker: Marker | undefined;
  const photoMarkers: Marker[] = [];
  let weatherMarkers: Marker[] = [];
  let weatherPopup: Popup | undefined;
  const [ready, setReady] = createSignal(false);

  /**
   * Redrawn from scratch on every change rather than diffed — the list is at
   * most a couple dozen entries (one per hour of a stretched plan), so a full
   * rebuild is simpler than reconciling and no less correct.
   *
   * The popup is managed by hand (open/close on hover, toggle on click)
   * instead of `Marker.setPopup()`, whose own click-to-toggle would otherwise
   * fight with the hover handlers below over the same open/closed state.
   */
  function drawWeatherMarkers(instance: MapLibreMap) {
    weatherMarkers.forEach((marker) => {
      marker.remove();
    });
    weatherMarkers = [];
    weatherPopup?.remove();
    weatherPopup = undefined;

    const baseStyle =
      "display:flex;align-items:center;gap:2px;padding:2px 7px 2px 3px;border-radius:999px;background:var(--surface);border:1.5px solid var(--border-subtle);box-shadow:0 1px 4px rgb(0 0 0 / 0.25);";

    for (const point of props.weatherMarkers?.() ?? []) {
      if (point.status === "ready") {
        // A real `<button>`, not a `<div>`: it's the only place the wind/precipitation
        // detail lives, so it needs to be reachable by keyboard and announced by a
        // screen reader, matching the photo pins' pattern below.
        const el = document.createElement("button");
        el.type = "button";
        el.className = "weather-marker-btn";
        el.style.cssText = `${baseStyle}cursor:pointer;font:inherit;`;
        el.setAttribute("aria-label", weatherAriaLabel(point));
        const temp = point.temperatureC != null ? `${Math.round(point.temperatureC)}°` : "";
        el.innerHTML = `${weatherIconMarkup(point.symbolCode)}<span style="font-size:12px;font-weight:600;">${temp}</span>`;

        // `closeOnClick` is MapLibre's default, but it closes on *any* map
        // click whose target isn't a descendant of the popup itself — which
        // includes a click on the very marker button that just opened it (the
        // popup is a sibling overlay, not an ancestor). Turned off here and
        // replaced with the map-level listener in `onMount`, which knows to
        // leave a click on a weather marker alone.
        const popup = new Popup({
          offset: 16,
          closeButton: false,
          closeOnClick: false,
          className: "weather-popup",
        }).setHTML(weatherPopupHtml(point));
        // `open`/`close` only ever *set* the popup's state — they don't toggle —
        // so hover, focus and click can all call `open` without a mouse click
        // (which fires right after `mouseenter` on a real click) immediately
        // flipping it back closed.
        const open = () => {
          if (weatherPopup !== popup) weatherPopup?.remove();
          popup.setLngLat([point.lon, point.lat]).addTo(instance);
          weatherPopup = popup;
        };
        const close = () => {
          popup.remove();
          if (weatherPopup === popup) weatherPopup = undefined;
        };
        el.addEventListener("mouseenter", open);
        el.addEventListener("mouseleave", close);
        el.addEventListener("focus", open);
        el.addEventListener("blur", close);
        el.addEventListener("click", open); // Touch has no hover event, so a tap still needs to open it.

        weatherMarkers.push(new Marker({ element: el }).setLngLat([point.lon, point.lat]).addTo(instance));
        continue;
      }

      const el = document.createElement("div");
      el.style.cssText = `${baseStyle}cursor:default;`;
      if (point.status === "loading") {
        el.innerHTML = `<span class="weather-marker-spinner"></span>`;
      } else {
        el.setAttribute("aria-label", "Forecast unavailable");
        el.innerHTML = `<span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;color:var(--ink-muted);font-size:12px;">?</span>`;
      }
      weatherMarkers.push(new Marker({ element: el }).setLngLat([point.lon, point.lat]).addTo(instance));
    }
  }

  /**
   * Photo pins, drawn once on initial load rather than from `styledata` like
   * `drawTracks` — MapLibre `Marker`s are plain DOM overlays independent of
   * the style/sources, so they survive a basemap swap (see the fallback
   * handler below) without needing to be re-added.
   */
  function drawPhotoPins(instance: MapLibreMap) {
    for (const photo of props.photos ?? []) {
      if (photo.lat == null || photo.lon == null) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", photo.caption ?? "Photo");
      el.style.cssText = `width:28px;height:28px;border-radius:50%;background-image:url("${photo.thumbUrl}");background-size:cover;background-position:center;border:2.5px solid #fff;box-shadow:0 1px 4px rgb(0 0 0 / 0.4);cursor:pointer;padding:0;`;
      el.addEventListener("click", () => props.onSelectPhoto?.(photo.id));
      photoMarkers.push(new Marker({ element: el }).setLngLat([photo.lon, photo.lat]).addTo(instance));
    }
  }

  /** Adds the source+layers for every track. Re-run whenever the style reloads. */
  function drawTracks(instance: MapLibreMap) {
    props.tracks.forEach((track) => {
      if (track.coordinates.length < 2) return;
      const sourceId = `track-${track.id}`;

      if (instance.getSource(sourceId)) return;

      instance.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: track.coordinates },
        },
      });

      // A dark casing under the coloured line keeps the track legible over both
      // pale terrain and dark forest on the basemap.
      instance.addLayer({
        id: `${sourceId}-casing`,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#00000055",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 5, 14, 9],
        },
      });

      instance.addLayer({
        id: sourceId,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": track.color,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 5],
        },
      });
    });

    applyTrackVisibility(instance);
  }

  /** Shows/hides each track's layers to match the Tracks list checkboxes. */
  function applyTrackVisibility(instance: MapLibreMap) {
    const visible = props.visibleTrackIds();
    for (const track of props.tracks) {
      const sourceId = `track-${track.id}`;
      const visibility = visible.has(track.id) ? "visible" : "none";
      if (instance.getLayer(sourceId)) instance.setLayoutProperty(sourceId, "visibility", visibility);
      if (instance.getLayer(`${sourceId}-casing`)) {
        instance.setLayoutProperty(`${sourceId}-casing`, "visibility", visibility);
      }
    }
  }

  /**
   * Start pin on the first visible track, finish on the last — recomputed
   * whenever a track is toggled, not fixed to the overall route's ends, so
   * isolating one stage pins that stage's own start/finish.
   */
  function updateEndpointMarkers(instance: MapLibreMap) {
    startMarker?.remove();
    finishMarker?.remove();
    startMarker = undefined;
    finishMarker = undefined;

    const visible = props.visibleTrackIds();
    const shown = props.tracks.filter((t) => visible.has(t.id) && t.coordinates.length >= 2);
    if (shown.length === 0) return;

    const first = shown[0];
    const last = shown[shown.length - 1];
    startMarker = addEndpoint(instance, first.coordinates[0], "#2f9e44", "Start");
    finishMarker = addEndpoint(instance, last.coordinates[last.coordinates.length - 1], "#e03131", "Finish");
  }

  function addEndpoint(
    instance: MapLibreMap,
    coord: [number, number],
    color: string,
    label: string,
  ): Marker {
    const el = document.createElement("div");
    el.setAttribute("aria-label", label);
    el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 0 0 1px rgb(0 0 0 / 0.25);`;
    return new Marker({ element: el }).setLngLat(coord).addTo(instance);
  }

  function fitToRoute(instance: MapLibreMap) {
    const bounds = new LngLatBounds();
    let any = false;
    for (const track of props.tracks) {
      for (const coord of track.coordinates) {
        bounds.extend(coord);
        any = true;
      }
    }
    if (!any) return;
    instance.fitBounds(bounds, {
      // Extra bottom padding leaves room for the attribution and, on mobile,
      // the sheet that overlaps the map.
      padding: { top: 48, right: 32, bottom: 64, left: 32 },
      animate: false,
      maxZoom: 16,
    });
  }

  onMount(() => {
    const instance = new MapLibreMap({
      container,
      style: HIKING_STYLE,
      center: [0, 0],
      zoom: 1,
      attributionControl: { compact: true },
      // One-finger drag scrolls the page instead of panning the map, which is
      // what a visitor scrolling a route page on a phone expects.
      cooperativeGestures: true,
    });

    map = instance;

    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(
      new GeolocateControl({ positionOptions: { enableHighAccuracy: true } }),
      "top-right",
    );
    instance.addControl(new ScaleControl({ maxWidth: 96, unit: "metric" }), "bottom-left");

    instance.on("load", () => {
      drawTracks(instance);
      updateEndpointMarkers(instance);
      fitToRoute(instance);
      drawPhotoPins(instance);
      setReady(true);
    });

    /*
     * Swap to standard OSM tiles if the hiking server is unreachable. A handful
     * of failures is tolerated first: a single 404 over the sea or one dropped
     * request shouldn't change the basemap under the user.
     */
    let tileFailures = 0;
    instance.on("error", (event) => {
      if (instance.getSource("osm")) return; // Already on the fallback.
      const message = String(event.error?.message ?? "");
      const isTileProblem =
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.includes("openmaps.fr");
      if (!isTileProblem) return;
      if (++tileFailures >= 4) instance.setStyle(FALLBACK_STYLE);
    });

    // setStyle drops all layers, so the tracks are re-added after a style swap.
    instance.on("styledata", () => {
      if (instance.isStyleLoaded() && !instance.getSource(`track-${props.tracks[0]?.id}`)) {
        drawTracks(instance);
      }
    });

    // Closes a hover/focus/tap-opened weather popup on a click anywhere else
    // on the map — the touch-friendly equivalent of `mouseleave`. Skips clicks
    // on a weather marker itself: that marker's own listener already decided
    // whether to open it, and closing it again here would undo that.
    instance.on("click", (event) => {
      const target = event.originalEvent?.target as HTMLElement | null;
      if (target?.closest(".weather-marker-btn")) return;
      weatherPopup?.remove();
      weatherPopup = undefined;
    });

    onCleanup(() => {
      hoverMarker?.remove();
      startMarker?.remove();
      finishMarker?.remove();
      photoMarkers.forEach((marker) => {
        marker.remove();
      });
      weatherMarkers.forEach((marker) => {
        marker.remove();
      });
      weatherPopup?.remove();
      instance.remove();
    });
  });

  // Re-syncs layer visibility and the start/finish pins whenever a track is
  // toggled in the Tracks list.
  createEffect(() => {
    props.visibleTrackIds();
    const instance = map;
    if (!instance || !ready()) return;
    applyTrackVisibility(instance);
    updateEndpointMarkers(instance);
  });

  // Redrawn whenever the plan panel's schedule/weather changes.
  createEffect(() => {
    props.weatherMarkers?.();
    const instance = map;
    if (!instance || !ready()) return;
    drawWeatherMarkers(instance);
  });

  // Follow the elevation-profile hover with a marker.
  createEffect(() => {
    const point = props.hovered();
    const instance = map;
    if (!instance || !ready()) return;

    if (!point) {
      hoverMarker?.remove();
      hoverMarker = undefined;
      return;
    }

    if (!hoverMarker) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid #e8590c;box-shadow:0 1px 4px rgb(0 0 0 / 0.4);pointer-events:none;";
      hoverMarker = new Marker({ element: el });
    }
    hoverMarker.setLngLat([point.lon, point.lat]).addTo(instance);
  });

  return (
    // `route-map` exists so app.css can override MapLibre's own control styles:
    // both stylesheets otherwise use the same specificity and MapLibre's loads last.
    <div class={`route-map ${props.class ?? ""}`} style={{ position: "relative" }}>
      <div ref={container} style={{ position: "absolute", inset: "0" }} role="application" aria-label="Route map" />
      <Show when={!ready()}>
        <MapSkeleton class="pointer-events-none absolute inset-0" />
      </Show>
    </div>
  );
}

/**
 * Gates `MapCanvas` behind connectivity: there's nothing productive it can do
 * offline (no cached tiles, no style to fetch — see the offline/PWA ticket's
 * research writeup), so it isn't even instantiated then. `<Show>` mounting a
 * fresh `MapCanvas` on regaining connectivity is simpler and more correct
 * than trying to resume a half-initialized MapLibre instance in place.
 */
export default function RouteMap(props: RouteMapProps) {
  const offline = createOnlineSignal();
  return (
    <Show
      when={!offline()}
      fallback={<MapSkeleton class={props.class} message="Map unavailable offline" pulse={false} />}
    >
      <MapCanvas {...props} />
    </Show>
  );
}
