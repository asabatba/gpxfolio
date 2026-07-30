import { Meta, Title } from "@solidjs/meta";
import { A, createAsync, query, type RouteDefinition } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";
import SiteHeader from "~/components/SiteHeader";
import TrackThumbnail from "~/components/TrackThumbnail";
import { formatDateShort, formatDistance, formatElevation } from "~/lib/format";

const getGallery = query(async () => {
  "use server";
  const { listPublicRoutes, listRouteThumbnails } = await import("~/lib/routes.server");
  const routes = await listPublicRoutes();
  const thumbnails = await listRouteThumbnails(routes.map((r) => r.id));

  return {
    siteName: process.env.PUBLIC_SITE_NAME ?? "My Routes",
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

  return (
    <Suspense>
      <Show when={data()}>
        {(gallery) => (
          <>
            <Title>{gallery().siteName}</Title>
            <Meta name="description" content={`Routes shared by ${gallery().siteName}.`} />

            <SiteHeader siteName={gallery().siteName}>
              <A href="/admin" class="btn btn-ghost text-sm">
                Admin
              </A>
            </SiteHeader>

            <main class="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
              <div class="py-8 sm:py-12">
                <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Routes</h1>
                <p class="ink-muted mt-2 max-w-prose text-[0.9375rem]">
                  Tracks I've recorded, with maps, elevation profiles and stats.
                </p>
              </div>

              <Show
                when={gallery().routes.length > 0}
                fallback={
                  <div class="card rounded-xl px-6 py-12 text-center">
                    <p class="font-medium">No public routes yet.</p>
                    <p class="ink-muted mt-1 text-sm">
                      Upload a GPX file from the{" "}
                      <A href="/admin" class="underline underline-offset-2">
                        admin page
                      </A>{" "}
                      and set it to public to see it here.
                    </p>
                  </div>
                }
              >
                <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <For each={gallery().routes}>
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
        )}
      </Show>
    </Suspense>
  );
}
