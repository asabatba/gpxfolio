import {
  GeolocateControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type StyleSpecification,
} from "maplibre-gl";
import { createEffect, createSignal, onCleanup, onMount, Show, type Accessor } from "solid-js";
import MapSkeleton from "~/components/MapSkeleton";
import type { WeatherMarkerView } from "~/components/RoutePlanner";
import type { BBox } from "~/lib/gpx/types";
import type { HoverPoint, PhotoView, TrackView } from "~/lib/track-view";
import { weatherIconMarkup } from "~/lib/weather-icons";
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

/**
 * OpenHikingMap raster tiles: OSM data rendered with paths, trail waymarks and
 * contour lines, which is what a route page actually wants behind a track.
 *
 * Raster rather than vector, so there is a single rendering and no dark variant —
 * the basemap looks the same in both colour schemes, while the app chrome and the
 * map controls still follow the system theme (see app.css).
 *
 * Zoom range verified against the server: z18 is the deepest level served (z19
 * returns 404). `maxzoom: 18` makes MapLibre upscale past that rather than
 * request tiles that don't exist.
 */
const HIKING_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    hiking: {
      type: "raster",
      tiles: ["https://tile.openmaps.fr/hiking/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &middot; tiles <a href="https://tile.openmaps.fr" target="_blank" rel="noopener">openmaps.fr</a>',
    },
  },
  layers: [{ id: "hiking", type: "raster", source: "hiking" }],
};

/**
 * MapLibre works out its worker's URL at runtime by rewriting its own module
 * URL. Vite can't see through that, so the worker chunk is never emitted and the
 * request lands on the SPA fallback — which returns the HTML page with a 200.
 * The worker then fails to start, and the map never fires `load`: blank map, no
 * track, and no error anywhere. Pointing MapLibre at a copy served from
 * `public/maplibre/` (see scripts/copy-maplibre-worker.mjs) avoids the guesswork
 * entirely, in dev and production alike.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/**
 * Fallback used when the hiking tiles can't be reached. openmaps.fr is a
 * community server with no published uptime guarantee, so a route stays viewable
 * on standard OSM tiles rather than showing an empty grey box.
 */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

export default function RouteMap(props: RouteMapProps) {
  let container!: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let hoverMarker: Marker | undefined;
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

    for (const point of props.weatherMarkers?.() ?? []) {
      const el = document.createElement("div");
      el.style.cssText =
        "display:flex;align-items:center;gap:2px;padding:2px 7px 2px 3px;border-radius:999px;background:var(--surface);border:1.5px solid var(--border-subtle);box-shadow:0 1px 4px rgb(0 0 0 / 0.25);cursor:default;";

      if (point.status === "loading") {
        el.innerHTML = `<span class="weather-marker-spinner"></span>`;
      } else if (point.status === "unavailable") {
        el.setAttribute("aria-label", "Forecast unavailable");
        el.innerHTML = `<span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;color:var(--ink-muted);font-size:12px;">?</span>`;
      } else {
        const temp = point.temperatureC != null ? `${Math.round(point.temperatureC)}°` : "";
        el.innerHTML = `${weatherIconMarkup(point.symbolCode)}<span style="font-size:12px;font-weight:600;">${temp}</span>`;

        const popup = new Popup({ offset: 16, closeButton: false, className: "weather-popup" }).setHTML(
          weatherPopupHtml(point),
        );
        let popupOpen = false;
        const open = () => {
          weatherPopup?.remove();
          popup.setLngLat([point.lon, point.lat]).addTo(instance);
          weatherPopup = popup;
          popupOpen = true;
        };
        const close = () => {
          popup.remove();
          popupOpen = false;
        };
        el.addEventListener("mouseenter", open);
        el.addEventListener("mouseleave", close);
        el.addEventListener("click", () => (popupOpen ? close() : open()));
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
    props.tracks.forEach((track, index) => {
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

      // Start and finish markers, only for the first and last track so a
      // multi-day route isn't peppered with dots.
      const isFirst = index === 0;
      const isLast = index === props.tracks.length - 1;
      if (isFirst) {
        addEndpoint(instance, track.coordinates[0], "#2f9e44", "Start");
      }
      if (isLast) {
        addEndpoint(
          instance,
          track.coordinates[track.coordinates.length - 1],
          "#e03131",
          "Finish",
        );
      }
    });
  }

  function addEndpoint(
    instance: MapLibreMap,
    coord: [number, number],
    color: string,
    label: string,
  ) {
    const el = document.createElement("div");
    el.setAttribute("aria-label", label);
    el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 0 0 1px rgb(0 0 0 / 0.25);`;
    new Marker({ element: el }).setLngLat(coord).addTo(instance);
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

    onCleanup(() => {
      hoverMarker?.remove();
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
