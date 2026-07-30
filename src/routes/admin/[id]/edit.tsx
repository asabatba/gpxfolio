import { Title } from "@solidjs/meta";
import {
  A,
  createAsync,
  query,
  useAction,
  useParams,
  useSubmission,
  type RouteDefinition,
} from "@solidjs/router";
import { createSignal, For, Show, Suspense } from "solid-js";
import SiteHeader from "~/components/SiteHeader";
import UploadDropzone from "~/components/UploadDropzone";
import { addTracksAction, deleteTrackAction, updateRouteAction } from "~/lib/actions";
import { formatCount, formatDistance, formatElevation } from "~/lib/format";

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;

const getRouteForEdit = query(async (id: string) => {
  "use server";
  const { requireAdmin } = await import("~/lib/auth");
  const { getRouteById } = await import("~/lib/routes.server");
  await requireAdmin();

  const route = await getRouteById(id);
  if (!route) return null;

  return {
    id: route.id,
    slug: route.slug,
    title: route.title,
    description: route.description ?? "",
    activityType: route.activityType ?? "",
    visibility: route.visibility,
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    tracks: route.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      color: track.color,
      sourceFilename: track.sourceFilename,
      distanceM: track.distanceM,
      pointCountOriginal: track.pointCountOriginal,
      pointCountStored: track.pointCountStored,
    })),
  };
}, "routeForEdit");

export const route = {
  preload: ({ params }) => getRouteForEdit(params.id as string),
} satisfies RouteDefinition;

export default function EditRoute() {
  const params = useParams();
  const data = createAsync(() => getRouteForEdit(params.id as string));
  const updateSubmission = useSubmission(updateRouteAction);
  const addSubmission = useSubmission(addTracksAction);
  const removeTrack = useAction(deleteTrackAction);
  const [fileCount, setFileCount] = createSignal(0);

  function confirmRemoveTrack(routeId: string, trackId: string, label: string) {
    if (!confirm(`Remove "${label}" from this route?`)) return;
    const formData = new FormData();
    formData.set("routeId", routeId);
    formData.set("trackId", trackId);
    void removeTrack(formData);
  }

  return (
    <Suspense fallback={<p class="ink-muted p-6 text-sm">Loading…</p>}>
      <Show
        when={data()}
        fallback={
          <main class="mx-auto max-w-md px-6 py-20 text-center">
            <h1 class="text-xl font-semibold">Route not found</h1>
            <A href="/admin" class="btn btn-secondary mt-4">
              Back to routes
            </A>
          </main>
        }
      >
        {(route) => (
          <>
            <Title>Edit {route().title}</Title>
            <SiteHeader siteName="Edit route">
              <A href={`/r/${route().slug}`} class="btn btn-ghost text-sm">
                View
              </A>
              <A href="/admin" class="btn btn-ghost text-sm">
                Done
              </A>
            </SiteHeader>

            <main class="mx-auto w-full max-w-2xl px-4 pb-16 sm:px-6">
              <div class="py-6">
                <h1 class="text-2xl font-semibold tracking-tight">{route().title}</h1>
                <p class="tabular ink-muted mt-1 text-sm">
                  {formatDistance(route().distanceM)} ·{" "}
                  {formatElevation(route().elevationGainM)} ascent · {route().tracks.length} track
                  {route().tracks.length === 1 ? "" : "s"}
                </p>
              </div>

              <form
                action={updateRouteAction}
                method="post"
                class="card flex flex-col gap-5 rounded-xl p-4 sm:p-5"
              >
                <input type="hidden" name="routeId" value={route().id} />

                <div>
                  <label class="label" for="title">
                    Title
                  </label>
                  <input
                    id="title"
                    name="title"
                    class="field"
                    value={route().title}
                    required
                    maxlength="120"
                  />
                </div>

                <div>
                  <label class="label" for="description">
                    Description
                  </label>
                  {/* `value`, not a child: JSX indentation inside a textarea
                      would be submitted as leading whitespace. */}
                  <textarea
                    id="description"
                    name="description"
                    class="field resize-y"
                    rows="3"
                    maxlength="2000"
                    value={route().description}
                  />
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label class="label" for="activityType">
                      Activity
                    </label>
                    <input
                      id="activityType"
                      name="activityType"
                      class="field"
                      value={route().activityType}
                      maxlength="40"
                    />
                  </div>
                  <div>
                    <label class="label" for="visibility">
                      Visibility
                    </label>
                    <select id="visibility" name="visibility" class="field">
                      <option value="unlisted" selected={route().visibility === "unlisted"}>
                        Unlisted
                      </option>
                      <option value="public" selected={route().visibility === "public"}>
                        Public
                      </option>
                    </select>
                  </div>
                </div>

                {/* The slug is fixed once created so already-shared links keep working. */}
                <p class="ink-muted text-xs">
                  Link stays <code>/r/{route().slug}</code> even if you rename the route.
                </p>

                <Show when={updateSubmission.result instanceof Error}>
                  <p role="alert" class="text-sm" style={{ color: "#e03131" }}>
                    {(updateSubmission.result as Error).message}
                  </p>
                </Show>

                <button type="submit" class="btn btn-primary self-start" disabled={updateSubmission.pending}>
                  {updateSubmission.pending ? "Saving…" : "Save changes"}
                </button>
              </form>

              <section class="mt-6">
                <h2 class="mb-2 font-semibold">Tracks</h2>
                <ul class="flex flex-col gap-2">
                  <For each={route().tracks}>
                    {(track) => (
                      <li class="card flex items-center gap-3 rounded-lg p-3">
                        <span
                          class="h-3 w-3 shrink-0 rounded-full"
                          style={{ "background-color": track.color }}
                          aria-hidden="true"
                        />
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-sm font-medium">
                            {track.name ?? track.sourceFilename}
                          </p>
                          <p class="tabular ink-muted text-xs">
                            {formatDistance(track.distanceM)} ·{" "}
                            {formatCount(track.pointCountOriginal)} →{" "}
                            {formatCount(track.pointCountStored)} points
                          </p>
                        </div>
                        <Show when={route().tracks.length > 1}>
                          <button
                            type="button"
                            class="btn btn-danger !min-h-[36px] shrink-0 px-2.5 text-xs"
                            onClick={() =>
                              confirmRemoveTrack(
                                route().id,
                                track.id,
                                track.name ?? track.sourceFilename,
                              )
                            }
                          >
                            Remove
                          </button>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </section>

              <section class="mt-6">
                <h2 class="mb-2 font-semibold">Add more tracks</h2>
                <form action={addTracksAction} method="post" enctype="multipart/form-data">
                  <input type="hidden" name="routeId" value={route().id} />
                  <UploadDropzone
                    name="files"
                    maxFiles={MAX_FILES}
                    maxBytes={MAX_BYTES}
                    onChange={(files) => setFileCount(files.length)}
                  />
                  <Show when={addSubmission.result instanceof Error}>
                    <p role="alert" class="mt-2 text-sm" style={{ color: "#e03131" }}>
                      {(addSubmission.result as Error).message}
                    </p>
                  </Show>
                  <button
                    type="submit"
                    class="btn btn-secondary mt-3"
                    disabled={addSubmission.pending || fileCount() === 0}
                  >
                    {addSubmission.pending ? "Processing…" : "Add tracks"}
                  </button>
                </form>
              </section>
            </main>
          </>
        )}
      </Show>
    </Suspense>
  );
}
