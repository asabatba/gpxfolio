import { LngLatBounds, Map as MapLibreMap } from "maplibre-gl";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import MapSkeleton from "~/components/MapSkeleton";
import { FALLBACK_STYLE, HIKING_STYLE } from "~/lib/map-style";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * MapLibre v6 is ESM-only and imports are namespaced/named — there is no default
 * export. This component is loaded through `clientOnly()` by its callers so the
 * library never runs during SSR, where `window` does not exist.
 */

export interface PreviewTrack {
  id: string;
  color: string;
  /** `[lon, lat]` pairs, the order MapLibre expects. */
  coordinates: Array<[number, number]>;
}

interface PreviewMapProps {
  tracks: PreviewTrack[];
  class?: string;
}

/**
 * A stripped-down map for the upload preview: draws tracks and fits bounds,
 * nothing else. No nav/geolocate/scale controls, no photo pins, no hover
 * marker — this is a glance-and-confirm ("did I upload the right file?"),
 * not a page to navigate. See RouteMap for the full-featured version used on
 * published route pages.
 */
export default function PreviewMap(props: PreviewMapProps) {
  let container!: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let addedSourceIds: string[] = [];
  const [ready, setReady] = createSignal(false);

  function clearTracks(instance: MapLibreMap) {
    for (const sourceId of addedSourceIds) {
      if (instance.getLayer(sourceId)) instance.removeLayer(sourceId);
      if (instance.getLayer(`${sourceId}-casing`)) instance.removeLayer(`${sourceId}-casing`);
      if (instance.getSource(sourceId)) instance.removeSource(sourceId);
    }
    addedSourceIds = [];
  }

  function drawTracks(instance: MapLibreMap) {
    for (const track of props.tracks) {
      if (track.coordinates.length < 2) continue;
      const sourceId = `preview-track-${track.id}`;
      addedSourceIds.push(sourceId);

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
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 14, 7],
        },
      });

      instance.addLayer({
        id: sourceId,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": track.color,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 4],
        },
      });
    }
  }

  function fitToTracks(instance: MapLibreMap) {
    const bounds = new LngLatBounds();
    let any = false;
    for (const track of props.tracks) {
      for (const coord of track.coordinates) {
        bounds.extend(coord);
        any = true;
      }
    }
    if (!any) return;
    instance.fitBounds(bounds, { padding: 24, animate: false, maxZoom: 15 });
  }

  onMount(() => {
    const instance = new MapLibreMap({
      container,
      style: HIKING_STYLE,
      center: [0, 0],
      zoom: 1,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });

    map = instance;

    instance.on("load", () => {
      drawTracks(instance);
      fitToTracks(instance);
      setReady(true);
    });

    // Same tolerant fallback as RouteMap: a handful of failures is allowed
    // before assuming the hiking tile server is unreachable.
    let tileFailures = 0;
    instance.on("error", (event) => {
      if (instance.getSource("osm")) return;
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
      if (instance.isStyleLoaded() && addedSourceIds.some((id) => !instance.getSource(id))) {
        addedSourceIds = [];
        drawTracks(instance);
      }
    });

    onCleanup(() => instance.remove());
  });

  // Redrawn whenever the selected files (and so the parsed tracks) change.
  createEffect(() => {
    props.tracks;
    const instance = map;
    if (!instance || !instance.isStyleLoaded()) return;
    clearTracks(instance);
    drawTracks(instance);
    fitToTracks(instance);
  });

  return (
    <div class={`route-map ${props.class ?? ""}`} style={{ position: "relative" }}>
      <div
        ref={container}
        style={{ position: "absolute", inset: "0" }}
        role="img"
        aria-label="Preview of the uploaded route"
      />
      <Show when={!ready()}>
        <MapSkeleton class="pointer-events-none absolute inset-0" />
      </Show>
    </div>
  );
}
