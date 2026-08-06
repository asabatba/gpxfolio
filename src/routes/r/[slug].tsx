import { Title, Meta } from "@solidjs/meta";
import { A, createAsync, query, useParams, type RouteDefinition } from "@solidjs/router";
import { clientOnly } from "@solidjs/start";
import { createMemo, createSignal, For, Show, Suspense } from "solid-js";
import ElevationProfile from "~/components/ElevationProfile";
import MapSkeleton from "~/components/MapSkeleton";
import OfflineBadge from "~/components/OfflineBadge";
import PhotoGallery from "~/components/PhotoGallery";
import RoutePlanner, { type PlanState } from "~/components/RoutePlanner";
import ShareButton from "~/components/ShareButton";
import SiteHeader from "~/components/SiteHeader";
import StatsGrid from "~/components/StatsGrid";
import { formatDate, formatDateISO, formatDistance, formatElevation } from "~/lib/format";
import type { RouteStats } from "~/lib/gpx/types";
import type { RangeSelection } from "~/lib/range-stats";
import { bboxOrFallback, toPhotoView, toTrackView, type HoverPoint } from "~/lib/track-view";

// MapLibre touches `window` at import time, so it must never be evaluated on the
// server. Everything else on this page is server-rendered.
const RouteMap = clientOnly(() => import("~/components/RouteMap"));

// Shared with the `fallback` below so the skeleton occupies exactly the same
// box as the real map — no layout shift once the client chunk loads.
const MAP_CLASS =
  "mt-4 h-[52vh] max-h-[620px] min-h-[280px] w-full overflow-hidden rounded-xl border border-subtle sm:h-[58dvh]";

const getRoute = query(async (slug: string) => {
  "use server";
  const { getRouteBySlug } = await import("~/lib/routes.server");
  const { isAuthenticated } = await import("~/lib/auth");
  const [route, isAdmin] = await Promise.all([getRouteBySlug(slug), isAuthenticated()]);
  if (!route) return null;

  // Send only what the client draws with — the raw rows carry columns the page
  // never reads. `id` is the exception: it's only sent to an authenticated
  // admin, who needs it to link to `/admin/[id]/edit`.
  return {
    id: isAdmin ? route.id : null,
    isAdmin,
    slug: route.slug,
    title: route.title,
    description: route.description,
    activityType: route.activityType,
    visibility: route.visibility,
    startedAt: route.startedAt?.getTime() ?? null,
    bbox: route.bbox ?? null,
    siteName: process.env.PUBLIC_SITE_NAME ?? "gpxfolio",
    // Absolute per the OpenGraph spec — a relative og:image is undefined
    // behaviour for most unfurlers. Falls back to a relative URL (still
    // correct for same-origin previewers) if the site's origin isn't
    // configured, rather than omitting the tag.
    ogImageUrl: `${process.env.PUBLIC_SITE_URL ?? ""}/api/routes/${route.slug}/og.png`,
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
    photos: route.photos.map((photo) => toPhotoView(photo, route.slug)),
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
  const [range, setRange] = createSignal<RangeSelection | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = createSignal<string | null>(null);
  const [plan, setPlan] = createSignal<PlanState | null>(null);

  // Which stage's planner is expanded — at most one, so the map only ever
  // shows one stage's weather markers at a time.
  const [openStageId, setOpenStageId] = createSignal<string | null>(null);
  function toggleStage(trackId: string) {
    setPlan(null); // Drop the previous stage's markers immediately, not just when the new one computes its own.
    setOpenStageId((current) => (current === trackId ? null : trackId));
  }

  // Tracks unchecked in the Tracks list — empty by default, so every track
  // starts visible. Kept as "hidden" rather than "visible" so a freshly
  // loaded route doesn't need to know its own track ids up front.
  const [hiddenTrackIds, setHiddenTrackIds] = createSignal<Set<string>>(new Set());
  function toggleTrackVisible(trackId: string) {
    setHiddenTrackIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

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

          // Every track with recorded timestamps gets its own planner, stacked
          // in track order. A single-track route ends up with exactly one,
          // labelled the same generic way it always has been.
          const plannableTracks = createMemo(() =>
            route().tracks.filter((track) => track.timeOffsets && track.timeOffsets.length >= 2),
          );

          const visibleTrackIds = createMemo(() => {
            const hidden = hiddenTrackIds();
            return new Set(
              route()
                .tracks.filter((track) => !hidden.has(track.id))
                .map((track) => track.id),
            );
          });

          const elevationProfilePlan = () => {
            const state = plan();
            return state?.schedule ? { schedule: state.schedule, timeZone: state.timeZone } : null;
          };

          return (
            <>
              <Title>{route().title}</Title>
              <Meta name="description" content={route().description ?? summary()} />
              {/* OpenGraph tags so a shared link previews with the route summary. */}
              <Meta property="og:title" content={route().title} />
              <Meta property="og:description" content={route().description ?? summary()} />
              <Meta property="og:type" content="article" />
              <Meta property="og:image" content={route().ogImageUrl} />
              <Meta property="og:image:width" content="1200" />
              <Meta property="og:image:height" content="630" />
              <Meta name="twitter:card" content="summary_large_image" />
              <Meta name="twitter:image" content={route().ogImageUrl} />
              {/* Unlisted routes must never be indexed, or the slug stops being private. */}
              <Show when={route().visibility === "unlisted"}>
                <Meta name="robots" content="noindex, nofollow" />
              </Show>

              <SiteHeader siteName={route().siteName} isAdmin={route().isAdmin ?? false}>
                <Show when={route().isAdmin}>
                  <A href={`/admin/${route().id}/edit`} class="btn btn-secondary text-sm">
                    Edit
                  </A>
                </Show>
                <OfflineBadge />
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

                {/* Single-track routes keep today's one full-width toggle button.
                    Multi-track routes get a row of day chips instead — one big
                    button per stage stacked vertically was too much before you'd
                    even seen the map. Either way, every plannable track's
                    `RoutePlanner` stays mounted so a stage remembers its start
                    time/pace after you switch away and back; only the toggle
                    button's presentation differs. */}
                <Show
                  when={plannableTracks().length > 1}
                  fallback={
                    <Show when={plannableTracks()[0]}>
                      {(track) => (
                        <>
                          <div class="card mt-4 rounded-xl px-4 py-3">
                            <button
                              type="button"
                              class="btn btn-secondary tap w-full justify-between"
                              onClick={() => toggleStage(track().id)}
                              aria-expanded={openStageId() === track().id}
                              aria-controls={`plan-panel-${track().id}`}
                            >
                              <span>Plan this hike for a different day</span>
                              <span aria-hidden="true">
                                {openStageId() === track().id ? "−" : "+"}
                              </span>
                            </button>
                          </div>
                          <RoutePlanner
                            track={track()}
                            open={() => openStageId() === track().id}
                            onChange={setPlan}
                          />
                        </>
                      )}
                    </Show>
                  }
                >
                  <div class="mt-4 flex flex-wrap gap-2">
                    <For each={plannableTracks()}>
                      {(track, i) => (
                        <button
                          type="button"
                          class={`btn tap ${openStageId() === track.id ? "btn-primary" : "btn-secondary"}`}
                          onClick={() => toggleStage(track.id)}
                          aria-expanded={openStageId() === track.id}
                          aria-controls={`plan-panel-${track.id}`}
                        >
                          {track.name ?? `Day ${i() + 1}`}
                        </button>
                      )}
                    </For>
                  </div>
                  <For each={plannableTracks()}>
                    {(track) => (
                      <RoutePlanner
                        track={track}
                        open={() => openStageId() === track.id}
                        onChange={setPlan}
                      />
                    )}
                  </For>
                </Show>

                {/* Map first: it's the reason someone opened the link. Sized with
                    dvh so mobile browser chrome doesn't crop it. */}
                <RouteMap
                  tracks={route().tracks}
                  bbox={bboxOrFallback(route().bbox, route().tracks)}
                  hovered={hovered}
                  selectedRange={range}
                  photos={route().photos}
                  onSelectPhoto={setSelectedPhotoId}
                  weatherMarkers={() => plan()?.markers ?? []}
                  visibleTrackIds={visibleTrackIds}
                  class={MAP_CLASS}
                  fallback={<MapSkeleton class={MAP_CLASS} />}
                />

                <section class="card mt-4 rounded-xl px-2 py-3 sm:px-4">
                  <h2 class="ink-muted mb-1 px-2 text-[0.6875rem] font-semibold uppercase tracking-wider">
                    Elevation
                  </h2>
                  <ElevationProfile
                    tracks={route().tracks}
                    hovered={hovered}
                    setHovered={setHovered}
                    range={range}
                    setRange={setRange}
                    activityType={route().activityType}
                    plan={elevationProfilePlan}
                  />
                </section>

                <Show when={route().photos.length > 0}>
                  <section class="card mt-4 rounded-xl px-2 py-3 sm:px-4">
                    <h2 class="ink-muted mb-2 px-2 text-[0.6875rem] font-semibold uppercase tracking-wider">
                      Photos
                    </h2>
                    <PhotoGallery
                      photos={route().photos}
                      selected={selectedPhotoId}
                      onSelect={setSelectedPhotoId}
                    />
                  </section>
                </Show>

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
                            <input
                              type="checkbox"
                              class="tap h-4 w-4 shrink-0"
                              checked={!hiddenTrackIds().has(track.id)}
                              onChange={() => toggleTrackVisible(track.id)}
                              aria-label={`Show ${track.name ?? "Untitled track"} on the map`}
                            />
                            <span
                              class="h-3 w-3 shrink-0 rounded-full"
                              style={{ "background-color": track.color }}
                              aria-hidden="true"
                            />
                            <span class="min-w-0 flex-1 truncate text-sm font-medium">
                              {track.name ?? "Untitled track"}
                            </span>
                            <span class="tabular shrink-0 text-right text-xs leading-tight">
                              <Show when={track.startedAt}>
                                {(startedAt) => (
                                  <span class="ink-muted block">
                                    {formatDateISO(new Date(startedAt()))}
                                  </span>
                                )}
                              </Show>
                              <span class="block text-sm">
                                {formatDistance(track.distanceM)} ·{" "}
                                {formatElevation(track.elevationGainM)}
                              </span>
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
