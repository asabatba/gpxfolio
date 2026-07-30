import { Title, Meta } from "@solidjs/meta";
import { A, createAsync, query, useParams, type RouteDefinition } from "@solidjs/router";
import { clientOnly } from "@solidjs/start";
import { createSignal, For, Show, Suspense } from "solid-js";
import ElevationProfile from "~/components/ElevationProfile";
import ShareButton from "~/components/ShareButton";
import SiteHeader from "~/components/SiteHeader";
import StatsGrid from "~/components/StatsGrid";
import { formatDate, formatDistance, formatElevation } from "~/lib/format";
import type { RouteStats } from "~/lib/gpx/types";
import { bboxOrFallback, toTrackView, type HoverPoint } from "~/lib/track-view";

// MapLibre touches `window` at import time, so it must never be evaluated on the
// server. Everything else on this page is server-rendered.
const RouteMap = clientOnly(() => import("~/components/RouteMap"));

const getRoute = query(async (slug: string) => {
  "use server";
  const { getRouteBySlug } = await import("~/lib/routes.server");
  const route = await getRouteBySlug(slug);
  if (!route) return null;

  // Send only what the client draws with — the raw rows carry columns the page
  // never reads.
  return {
    slug: route.slug,
    title: route.title,
    description: route.description,
    activityType: route.activityType,
    visibility: route.visibility,
    startedAt: route.startedAt?.getTime() ?? null,
    bbox: route.bbox ?? null,
    siteName: process.env.PUBLIC_SITE_NAME ?? "gpxfolio",
    stats: {
      distanceM: route.distanceM,
      elevationGainM: route.elevationGainM,
      elevationLossM: route.elevationLossM,
      elevationMinM: route.elevationMinM,
      elevationMaxM: route.elevationMaxM,
      durationS: route.durationS,
      movingTimeS: route.movingTimeS,
      avgSpeedMps: route.avgSpeedMps,
      maxSpeedMps: route.maxSpeedMps,
    } satisfies RouteStats,
    tracks: route.tracks.map(toTrackView),
    totalPointsOriginal: route.tracks.reduce((sum, t) => sum + t.pointCountOriginal, 0),
    totalPointsStored: route.tracks.reduce((sum, t) => sum + t.pointCountStored, 0),
  };
}, "route");

export const route = {
  preload: ({ params }) => getRoute(params.slug as string),
} satisfies RouteDefinition;

export default function RoutePage() {
  const params = useParams();
  // deferStream holds the response until the route resolves, so <Title> and the
  // OpenGraph tags are in the flushed <head>. Without it the shell streams
  // first and a shared link previews with the default title instead of the
  // route's — which defeats the point of a shareable page.
  const data = createAsync(() => getRoute(params.slug as string), { deferStream: true });
  const [hovered, setHovered] = createSignal<HoverPoint | null>(null);

  return (
    <Suspense
      fallback={
        <div class="ink-muted flex min-h-[60vh] items-center justify-center text-sm">
          Loading route…
        </div>
      }
    >
      <Show
        when={data()}
        fallback={
          <main class="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
            <h1 class="text-2xl font-semibold">Route not found</h1>
            <p class="ink-muted text-sm">
              This link may have been mistyped, or the route may have been deleted.
            </p>
            <A href="/" class="btn btn-secondary">
              Go to the homepage
            </A>
          </main>
        }
      >
        {(route) => {
          const summary = () =>
            [
              formatDistance(route().stats.distanceM),
              `${formatElevation(route().stats.elevationGainM)} ascent`,
            ].join(" · ");

          return (
            <>
              <Title>{route().title}</Title>
              <Meta name="description" content={route().description ?? summary()} />
              {/* OpenGraph tags so a shared link previews with the route summary. */}
              <Meta property="og:title" content={route().title} />
              <Meta property="og:description" content={route().description ?? summary()} />
              <Meta property="og:type" content="article" />
              <Meta name="twitter:card" content="summary" />
              {/* Unlisted routes must never be indexed, or the slug stops being private. */}
              <Show when={route().visibility === "unlisted"}>
                <Meta name="robots" content="noindex, nofollow" />
              </Show>

              <SiteHeader siteName={route().siteName}>
                <ShareButton title={route().title} />
              </SiteHeader>

              <main class="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
                <div class="py-4 sm:py-6">
                  <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
                      {route().title}
                    </h1>
                    <Show when={route().activityType}>
                      {(type) => (
                        <span
                          class="surface-raised ink-muted rounded-full border border-subtle px-2.5 py-0.5 text-xs font-semibold"
                        >
                          {type()}
                        </span>
                      )}
                    </Show>
                  </div>
                  <Show when={route().startedAt}>
                    {(time) => (
                      <p class="ink-muted mt-1 text-sm">{formatDate(new Date(time()))}</p>
                    )}
                  </Show>
                  <Show when={route().description}>
                    <p class="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed">
                      {route().description}
                    </p>
                  </Show>
                </div>

                {/* Map first: it's the reason someone opened the link. Sized with
                    dvh so mobile browser chrome doesn't crop it. */}
                <RouteMap
                  tracks={route().tracks}
                  bbox={bboxOrFallback(route().bbox, route().tracks)}
                  hovered={hovered}
                  class="h-[52vh] max-h-[620px] min-h-[280px] w-full overflow-hidden rounded-xl border border-subtle sm:h-[58dvh]"
                />

                <section class="card mt-4 rounded-xl px-2 py-3 sm:px-4">
                  <h2 class="ink-muted mb-1 px-2 text-[0.6875rem] font-semibold uppercase tracking-wider">
                    Elevation
                  </h2>
                  <ElevationProfile
                    tracks={route().tracks}
                    hovered={hovered}
                    setHovered={setHovered}
                  />
                </section>

                <StatsGrid
                  stats={route().stats}
                  activityType={route().activityType}
                  class="mt-4"
                />

                <Show when={route().tracks.length > 1}>
                  <section class="mt-4">
                    <h2 class="ink-muted mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider">
                      Tracks
                    </h2>
                    <ul class="grid gap-2 sm:grid-cols-2">
                      <For each={route().tracks}>
                        {(track) => (
                          <li class="card flex items-center gap-3 rounded-lg px-3 py-2.5">
                            <span
                              class="h-3 w-3 shrink-0 rounded-full"
                              style={{ "background-color": track.color }}
                              aria-hidden="true"
                            />
                            <span class="min-w-0 flex-1 truncate text-sm font-medium">
                              {track.name ?? "Untitled track"}
                            </span>
                            <span class="tabular ink-muted shrink-0 text-sm">
                              {formatDistance(track.distanceM)}
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </Show>

                <footer class="ink-muted mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <a href={`/api/routes/${route().slug}/gpx`} class="tap underline underline-offset-2">
                    Download GPX
                  </a>
                  <span>
                    {route().totalPointsStored.toLocaleString()} of{" "}
                    {route().totalPointsOriginal.toLocaleString()} recorded points drawn
                  </span>
                </footer>
              </main>
            </>
          );
        }}
      </Show>
    </Suspense>
  );
}
