import { Title } from "@solidjs/meta";
import { A, createAsync, query, useAction, type RouteDefinition } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";
import SiteHeader from "~/components/SiteHeader";
import { deleteRouteAction, logoutAction, setVisibilityAction } from "~/lib/actions";
import { formatDateShort, formatDistance, formatElevation } from "~/lib/format";

const getAdminRoutes = query(async () => {
  "use server";
  const { requireAdmin } = await import("~/lib/auth");
  const { listAllRoutes } = await import("~/lib/routes.server");
  await requireAdmin();

  const routes = await listAllRoutes();
  return routes.map((route) => ({
    id: route.id,
    slug: route.slug,
    title: route.title,
    visibility: route.visibility,
    activityType: route.activityType,
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    startedAt: route.startedAt?.getTime() ?? null,
  }));
}, "adminRoutes");

export const route = {
  preload: () => getAdminRoutes(),
} satisfies RouteDefinition;

export default function AdminIndex() {
  const routes = createAsync(() => getAdminRoutes());
  const setVisibility = useAction(setVisibilityAction);
  const deleteRoute = useAction(deleteRouteAction);

  function toggleVisibility(id: string, current: "public" | "unlisted") {
    const formData = new FormData();
    formData.set("routeId", id);
    formData.set("visibility", current === "public" ? "unlisted" : "public");
    void setVisibility(formData);
  }

  function confirmDelete(id: string, title: string) {
    // Deleting removes the GPX blobs too, so it genuinely cannot be undone.
    if (!confirm(`Delete "${title}"? This removes its GPX files permanently.`)) return;
    const formData = new FormData();
    formData.set("routeId", id);
    void deleteRoute(formData);
  }

  return (
    <>
      <Title>Manage routes</Title>
      <SiteHeader siteName="Manage routes">
        <A href="/admin/new" class="btn btn-primary text-sm">
          New route
        </A>
        <form action={logoutAction} method="post">
          <button type="submit" class="btn btn-ghost text-sm">
            Sign out
          </button>
        </form>
      </SiteHeader>

      <main class="mx-auto w-full max-w-4xl px-4 pb-16 sm:px-6">
        <div class="py-6">
          <h1 class="text-2xl font-semibold tracking-tight">Your routes</h1>
          <p class="ink-muted mt-1 text-sm">
            Public routes appear on the homepage. Unlisted routes are reachable only by link.
          </p>
        </div>

        <Suspense fallback={<p class="ink-muted text-sm">Loading…</p>}>
          <Show
            when={(routes()?.length ?? 0) > 0}
            fallback={
              <div class="card rounded-xl px-6 py-12 text-center">
                <p class="font-medium">No routes yet.</p>
                <p class="ink-muted mt-1 text-sm">Upload a GPX file to create your first one.</p>
                <A href="/admin/new" class="btn btn-primary mt-4">
                  Upload GPX
                </A>
              </div>
            }
          >
            <ul class="flex flex-col gap-2">
              <For each={routes()}>
                {(item) => (
                  <li class="card flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <A
                          href={`/r/${item.slug}`}
                          class="truncate font-semibold underline-offset-2 hover:underline"
                        >
                          {item.title}
                        </A>
                        <span
                          class="rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold"
                          style={
                            item.visibility === "public"
                              ? { "background-color": "#2f9e4422", color: "#2f9e44" }
                              : { "background-color": "var(--surface-sunken)", color: "var(--ink-muted)" }
                          }
                        >
                          {item.visibility}
                        </span>
                      </div>
                      <p class="tabular ink-muted mt-1 flex flex-wrap gap-x-3 text-sm">
                        <span>{formatDistance(item.distanceM)}</span>
                        <span>{formatElevation(item.elevationGainM)} ↑</span>
                        <Show when={item.startedAt}>
                          {(time) => <span>{formatDateShort(new Date(time()))}</span>}
                        </Show>
                      </p>
                    </div>

                    <div class="flex shrink-0 flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        class="btn btn-secondary !min-h-[38px] px-3 text-xs"
                        onClick={() => toggleVisibility(item.id, item.visibility)}
                      >
                        Make {item.visibility === "public" ? "unlisted" : "public"}
                      </button>
                      <A
                        href={`/admin/${item.id}/edit`}
                        class="btn btn-secondary !min-h-[38px] px-3 text-xs"
                      >
                        Edit
                      </A>
                      <button
                        type="button"
                        class="btn btn-danger !min-h-[38px] px-3 text-xs"
                        onClick={() => confirmDelete(item.id, item.title)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Suspense>
      </main>
    </>
  );
}
