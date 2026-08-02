import { LngLatBounds, Map as MapLibreMap, NavigationControl } from "maplibre-gl";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import MapSkeleton from "~/components/MapSkeleton";
import { TRACK_COLORS } from "~/lib/gpx/colors";
import { decodePolyline } from "~/lib/gpx/encode";
import { overviewStyle } from "~/lib/map-style";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * MapLibre v6 is ESM-only and imports are namespaced/named — there is no default
 * export. This component is loaded through `clientOnly()` by its caller so the
 * library never runs during SSR, where `window` does not exist.
 */

interface ArchiveMapProps {
  /** Encoded polylines from every public route's tracks. */
  tracks: string[];
  class?: string;
}

/**
 * Every public route's track on one real, zoomable map. A single fixed scale
 * can't show a Pyrenees hike and a far-flung one both legibly at once — that's
 * inherent, not fixable by drawing harder — so unlike `TrackThumbnail` this is
 * an actual MapLibre map the viewer can zoom into. One uniform colour for
 * every line: with many routes at once, per-route colours (see `TRACK_COLORS`)
 * stop mapping to anything nameable without a legend anyway.
 *
 * Basemap is `overviewStyle` — a plain land/water silhouette, not the hiking
 * tiles RouteMap/PreviewMap use — see that function's comment for why.
 */
export default function ArchiveMap(props: ArchiveMapProps) {
  let container!: HTMLDivElement;
  const [ready, setReady] = createSignal(false);

  function drawTracks(instance: MapLibreMap) {
    props.tracks.forEach((geometry, index) => {
      const coordinates = decodePolyline(geometry).map(
        ([lat, lon]) => [lon, lat] as [number, number],
      );
      if (coordinates.length < 2) return;
      const sourceId = `archive-track-${index}`;
      if (instance.getSource(sourceId)) return;

      instance.addSource(sourceId, {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
      });

      // Same casing treatment as RouteMap/PreviewMap: keeps a thin line legible
      // over both the pale-land and dark-water fills.
      instance.addLayer({
        id: `${sourceId}-casing`,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#00000055",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2, 14, 7],
        },
      });
      instance.addLayer({
        id: sourceId,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": TRACK_COLORS[0],
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 14, 4],
        },
      });
    });
  }

  function fitToTracks(instance: MapLibreMap) {
    const bounds = new LngLatBounds();
    let any = false;
    for (const geometry of props.tracks) {
      for (const [lat, lon] of decodePolyline(geometry)) {
        bounds.extend([lon, lat]);
        any = true;
      }
    }
    if (!any) return;
    instance.fitBounds(bounds, { padding: 32, animate: false, maxZoom: 15 });
  }

  onMount(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const instance = new MapLibreMap({
      container,
      style: overviewStyle(media.matches),
      center: [0, 0],
      zoom: 1,
      // Nothing here needs attributing (see public/land-110m.LICENSE.txt) and
      // there's no tile source either, so the default control has nothing to show.
      attributionControl: false,
      cooperativeGestures: true,
    });

    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");

    instance.on("load", () => {
      drawTracks(instance);
      fitToTracks(instance);
      setReady(true);
    });

    // setStyle drops all layers, so tracks are re-added after a style swap.
    instance.on("styledata", () => {
      if (instance.isStyleLoaded() && !instance.getSource("archive-track-0")) {
        drawTracks(instance);
      }
    });

    // The raster basemap elsewhere on the site can't follow the colour scheme
    // (see HIKING_STYLE's comment), but plain fill colours aren't baked into an
    // image, so this map can — and should, rather than staying stuck on
    // whichever theme was active when it first mounted.
    const onSchemeChange = (event: MediaQueryListEvent) => {
      instance.setStyle(overviewStyle(event.matches));
    };
    media.addEventListener("change", onSchemeChange);

    onCleanup(() => {
      media.removeEventListener("change", onSchemeChange);
      instance.remove();
    });
  });

  return (
    <div class={`route-map ${props.class ?? ""}`} style={{ position: "relative" }}>
      <div
        ref={container}
        style={{ position: "absolute", inset: "0" }}
        role="application"
        aria-label="Map of every public route"
      />
      <Show when={!ready()}>
        <MapSkeleton class="pointer-events-none absolute inset-0" />
      </Show>
    </div>
  );
}
