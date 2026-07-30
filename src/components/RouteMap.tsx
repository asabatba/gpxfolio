import {
  GeolocateControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type StyleSpecification,
} from "maplibre-gl";
import { createEffect, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import type { BBox } from "~/lib/gpx/types";
import type { HoverPoint, TrackView } from "~/lib/track-view";
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
  class?: string;
}

/** OpenFreeMap serves these styles free and without an API key. */
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/bright";
// `positron` looks like a dark style by name but its background is rgb(242,243,240) —
// it's the pale grey one. `dark` is the actual dark basemap.
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

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

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/**
 * Fallback style used when OpenFreeMap can't be reached, so the route is still
 * visible on a plain OSM raster basemap rather than an empty grey box.
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
  const [ready, setReady] = createSignal(false);

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
      style: prefersDark() ? STYLE_DARK : STYLE_LIGHT,
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
      setReady(true);
    });

    // If the vector style fails (offline, provider down), swap in raster OSM.
    instance.on("error", (event) => {
      const message = String(event.error?.message ?? "");
      if (message.includes("style") || message.includes("Failed to fetch")) {
        if (instance.getSource("osm")) return;
        instance.setStyle(FALLBACK_STYLE);
      }
    });

    // Re-add layers after any style change, since setStyle drops them.
    instance.on("styledata", () => {
      if (instance.isStyleLoaded() && !instance.getSource(`track-${props.tracks[0]?.id}`)) {
        drawTracks(instance);
      }
    });

    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onSchemeChange = (event: MediaQueryListEvent) => {
      instance.setStyle(event.matches ? STYLE_DARK : STYLE_LIGHT);
    };
    scheme?.addEventListener("change", onSchemeChange);

    onCleanup(() => {
      scheme?.removeEventListener("change", onSchemeChange);
      hoverMarker?.remove();
      instance.remove();
    });
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
    </div>
  );
}
