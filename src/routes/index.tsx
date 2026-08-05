import { Meta, Title } from "@solidjs/meta";
import { A, createAsync, query, useSearchParams, type RouteDefinition } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";
import ArchiveStats from "~/components/ArchiveStats";
import SiteHeader from "~/components/SiteHeader";
import TrackThumbnail from "~/components/TrackThumbnail";
import { computeArchiveStats } from "~/lib/archive-stats";
import { formatDateShort, formatDistance, formatElevation } from "~/lib/format";

const getGallery = query(async () => {
  "use server";
  const { listPublicRoutes, listRouteThumbnails, listRouteStages } = await import(
    "~/lib/routes.server"
  );
  const { isAuthenticated } = await import("~/lib/auth");
  const routes = await listPublicRoutes();
  const routeIds = routes.map((r) => r.id);
  const [thumbnails, stages, isAdmin] = await Promise.all([
    listRouteThumbnails(routeIds),
    listRouteStages(routeIds),
    isAuthenticated(),
  ]);

  return {
    isAdmin,
    siteName: process.env.PUBLIC_SITE_NAME ?? "gpxfolio",
    archiveStats: computeArchiveStats(routes, stages),
    trackGeometries: [...thumbnails.values()].flatMap((tracks) => tracks.map((t) => t.geometry)),
    routes: routes.map((route) => ({
      slug: route.slug,
      title: route.title,
      description: route.description,
      activityType: route.activityType,
      distanceM: route.distanceM,
      elevationGainM: route.elevationGainM,
      startedAt: route.startedAt?.getTime() ?? null,
      tracks: thumbnails.get(route.id) ?? [],
    })),
  };
}, "gallery");

export const route = {
  preload: () => getGallery(),
} satisfies RouteDefinition;

export default function Home() {
  // deferStream so the page title is present in the flushed <head>.
  const data = createAsync(() => getGallery(), { deferStream: true });
  // year lives in the URL (?year=2024) so a filtered view is bookmarkable/
  // shareable and survives a reload — see .wayfinder/tickets/search-filter-gallery.md.
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <Suspense>
      <Show when={data()}>
        {(gallery) => {
          // Newest first, matching the archive stats panel's own year ordering.
          const availableYears = () => {
            const years = new Set<number>();
            for (const route of gallery().routes) {
              if (route.startedAt) years.add(new Date(route.startedAt).getFullYear());
            }
            return [...years].sort((a, b) => b - a);
          };

          // Routes with no recorded start never match a specific year — only
          // "All years" — since there's no date to filter them by.
          const filteredRoutes = () => {
            const year = searchParams.year;
            if (!year) return gallery().routes;
            return gallery().routes.filter(
              (route) => route.startedAt != null && new Date(route.startedAt).getFullYear() === Number(year),
            );
          };

          return (
            <>
              <Title>{gallery().siteName}</Title>
              <Meta name="description" content={`Routes shared by ${gallery().siteName}.`} />

              <SiteHeader siteName={gallery().siteName} isAdmin={gallery().isAdmin} />

              <main class="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
                <div class="py-8 sm:py-12">
                  <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Routes</h1>
                  <p class="ink-muted mt-2 max-w-prose text-[0.9375rem]">
                    Tracks I've recorded, with maps, elevation profiles and stats.
                  </p>
                </div>

                <ArchiveStats stats={gallery().archiveStats} trackGeometries={gallery().trackGeometries} />

                <Show when={availableYears().length > 0}>
                  <div class="flex items-center justify-end gap-2 pb-4">
                    <label class="ink-muted text-xs font-semibold uppercase tracking-wider" for="year-filter">
                      Year
                    </label>
                    <select
                      id="year-filter"
                      class="field w-auto py-1.5 text-sm"
                      onChange={(event) => setSearchParams({ year: event.currentTarget.value || null })}
                    >
                      {/* `selected` on each <option>, not `value` on <select>: a plain HTML
                          parse (the SSR'd markup, before hydration) only honors the former —
                          `<select value>` is a Solid-only convenience that never reaches the
                          static HTML, so a hard reload of a filtered URL would otherwise
                          render the dropdown back on "All years" despite the list actually
                          being filtered. */}
                      <option value="" selected={!searchParams.year}>
                        All years
                      </option>
                      <For each={availableYears()}>
                        {(year) => (
                          <option value={year} selected={searchParams.year === String(year)}>
                            {year}
                          </option>
                        )}
                      </For>
                    </select>
                  </div>
                </Show>

                <Show
                  when={filteredRoutes().length > 0}
                  fallback={
                    <div class="card rounded-xl px-6 py-12 text-center">
                      <Show
                        when={gallery().routes.length > 0}
                        fallback={
                          <>
                            <p class="font-medium">No public routes yet.</p>
                            <p class="ink-muted mt-1 text-sm">
                              Upload a GPX file from the{" "}
                              <A href="/admin" class="underline underline-offset-2">
                                admin page
                              </A>{" "}
                              and set it to public to see it here.
                            </p>
                          </>
                        }
                      >
                        <p class="font-medium">No routes from {searchParams.year}.</p>
                        <button
                          type="button"
                          class="btn btn-secondary mt-3 text-sm"
                          onClick={() => setSearchParams({ year: null })}
                        >
                          Show all years
                        </button>
                      </Show>
                    </div>
                  }
                >
                  <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <For each={filteredRoutes()}>
                      {(item) => (
                        <li>
                          <A
                            href={`/r/${item.slug}`}
                            class="card group flex h-full flex-col overflow-hidden rounded-xl transition-transform hover:-translate-y-0.5"
                          >
                            <div class="surface-sunken border-b border-subtle">
                              <TrackThumbnail tracks={item.tracks} class="h-40 w-full" />
                            </div>
                            <div class="flex flex-1 flex-col gap-1.5 p-4">
                              <div class="flex items-start justify-between gap-2">
                                <h2 class="font-semibold leading-snug">{item.title}</h2>
                                <Show when={item.activityType}>
                                  {(type) => (
                                    <span class="ink-muted shrink-0 text-[0.6875rem] font-semibold uppercase tracking-wide">
                                      {type()}
                                    </span>
                                  )}
                                </Show>
                              </div>
                              <Show when={item.description}>
                                <p class="ink-muted line-clamp-2 text-sm">{item.description}</p>
                              </Show>
                              <div class="tabular ink-muted mt-auto flex flex-wrap items-center gap-x-3 pt-2 text-sm">
                                <span class="ink font-medium">{formatDistance(item.distanceM)}</span>
                                <span>{formatElevation(item.elevationGainM)} ↑</span>
                                <Show when={item.startedAt}>
                                  {(time) => (
                                    <span class="ml-auto text-xs">
                                      {formatDateShort(new Date(time()))}
                                    </span>
                                  )}
                                </Show>
                              </div>
                            </div>
                          </A>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </main>
            </>
          );
        }}
      </Show>
    </Suspense>
  );
}
