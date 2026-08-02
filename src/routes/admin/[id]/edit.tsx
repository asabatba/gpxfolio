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
import { createEffect, createSignal, For, Show, Suspense } from "solid-js";
import Breadcrumbs from "~/components/Breadcrumbs";
import ConfirmDialog, { type PendingConfirm } from "~/components/ConfirmDialog";
import SiteHeader from "~/components/SiteHeader";
import UploadDropzone from "~/components/UploadDropzone";
import UploadMapPreview from "~/components/UploadMapPreview";
import UploadProgress from "~/components/UploadProgress";
import {
  addPhotosAction,
  addTracksAction,
  deletePhotoAction,
  deleteTrackAction,
  moveTrackAction,
  nudgePhotoTimesAction,
  updatePhotoCaptionAction,
  updateRouteAction,
  updateTrackAction,
} from "~/lib/actions";
import { ACTIVITY_SUGGESTIONS } from "~/lib/activities";
import { formatBytes, formatCount, formatDistance, formatElevation, formatTime } from "~/lib/format";
import type { AddPhotosResult } from "~/lib/photos.server";
import { toPhotoView } from "~/lib/track-view";

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;

const MAX_PHOTOS_PER_UPLOAD = 40;
const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

/** "+2h 30m" / "-1h" / "no correction", for the post-upload inference banner. */
function formatOffset(minutes: number): string {
  if (minutes === 0) return "no correction";
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h > 0 ? `${h}h` : ""}${m > 0 ? ` ${m}m` : ""}`.trim();
}

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
    photos: route.photos.map((photo) => toPhotoView(photo, route.slug)),
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
  const [files, setFiles] = createSignal<File[]>([]);

  const addPhotosSubmission = useSubmission(addPhotosAction);
  const removePhoto = useAction(deletePhotoAction);
  const nudgeTimes = useAction(nudgePhotoTimesAction);
  const [photoFileCount, setPhotoFileCount] = createSignal(0);
  const [photoTotalBytes, setPhotoTotalBytes] = createSignal(0);
  const [selectedPhotos, setSelectedPhotos] = createSignal<Set<string>>(new Set());
  const [pendingConfirm, setPendingConfirm] = createSignal<PendingConfirm | null>(null);

  function confirmRemoveTrack(routeId: string, trackId: string, label: string) {
    setPendingConfirm({
      title: "Remove track",
      message: `Remove "${label}" from this route?`,
      confirmLabel: "Remove",
      onConfirm: () => {
        setPendingConfirm(null);
        const formData = new FormData();
        formData.set("routeId", routeId);
        formData.set("trackId", trackId);
        void removeTrack(formData);
      },
    });
  }

  function togglePhotoSelected(id: string) {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllPhotos(ids: string[]) {
    setSelectedPhotos(new Set(ids));
  }

  // A batch that just landed is the common case for a time correction — start
  // with all of it selected so "shift time" is one click away, instead of
  // making the admin check every thumbnail first.
  createEffect(() => {
    const result = addPhotosSubmission.result;
    if (result && !(result instanceof Error)) {
      selectAllPhotos((result as AddPhotosResult).photos.map((p) => p.id));
    }
  });

  function confirmRemovePhoto(routeId: string, photoId: string) {
    setPendingConfirm({
      title: "Delete photo",
      message: "Delete this photo? This can't be undone.",
      onConfirm: () => {
        setPendingConfirm(null);
        const formData = new FormData();
        formData.set("routeId", routeId);
        formData.set("photoId", photoId);
        void removePhoto(formData);
      },
    });
  }

  function applyTimeNudge(routeId: string, deltaMinutes: number) {
    const ids = Array.from(selectedPhotos());
    if (ids.length === 0) return;
    const formData = new FormData();
    formData.set("routeId", routeId);
    formData.set("photoIds", JSON.stringify(ids));
    formData.set("deltaMinutes", String(deltaMinutes));
    void nudgeTimes(formData);
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
            <Breadcrumbs
              items={[{ label: "Routes", href: "/admin" }, { label: route().title }, { label: "Edit" }]}
              class="max-w-2xl"
            />

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
                      list="activity-suggestions"
                      maxlength="40"
                    />
                    <datalist id="activity-suggestions">
                      <For each={ACTIVITY_SUGGESTIONS}>
                        {(activity) => <option value={activity} />}
                      </For>
                    </datalist>
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
                    {(track, index) => (
                      <li class="card flex flex-col gap-2.5 rounded-lg p-3">
                        <div class="flex items-center gap-3">
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
                          <form action={moveTrackAction} method="post" class="flex shrink-0 gap-1">
                            <input type="hidden" name="routeId" value={route().id} />
                            <input type="hidden" name="trackId" value={track.id} />
                            <button
                              type="submit"
                              name="direction"
                              value="up"
                              class="btn btn-ghost !min-h-[36px] px-2 text-xs"
                              aria-label={`Move ${track.name ?? track.sourceFilename} up`}
                              disabled={index() === 0}
                            >
                              ↑
                            </button>
                            <button
                              type="submit"
                              name="direction"
                              value="down"
                              class="btn btn-ghost !min-h-[36px] px-2 text-xs"
                              aria-label={`Move ${track.name ?? track.sourceFilename} down`}
                              disabled={index() === route().tracks.length - 1}
                            >
                              ↓
                            </button>
                          </form>
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
                        </div>

                        <form
                          action={updateTrackAction}
                          method="post"
                          class="flex flex-wrap items-center gap-2 border-t border-subtle pt-2.5"
                        >
                          <input type="hidden" name="routeId" value={route().id} />
                          <input type="hidden" name="trackId" value={track.id} />
                          <input
                            name="name"
                            class="field !min-h-0 min-w-[8rem] flex-1 px-2 py-1 text-xs"
                            value={track.name ?? ""}
                            placeholder={track.sourceFilename}
                            maxlength="120"
                            aria-label="Track name"
                          />
                          <button type="submit" class="btn btn-ghost !min-h-0 px-2 py-1 text-xs">
                            Save
                          </button>
                        </form>
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
                    onChange={setFiles}
                  />
                  <div class="mt-3">
                    <UploadMapPreview files={files()} />
                  </div>
                  <Show when={addSubmission.result instanceof Error}>
                    <p role="alert" class="mt-2 text-sm" style={{ color: "#e03131" }}>
                      {(addSubmission.result as Error).message}
                    </p>
                  </Show>
                  <button
                    type="submit"
                    class="btn btn-secondary mt-3"
                    disabled={addSubmission.pending || files().length === 0}
                  >
                    {addSubmission.pending ? "Processing…" : "Add tracks"}
                  </button>
                </form>
              </section>

              <section class="mt-6">
                <h2 class="mb-2 font-semibold">Photos</h2>
                <form action={addPhotosAction} method="post" enctype="multipart/form-data">
                  <input type="hidden" name="routeId" value={route().id} />
                  <UploadDropzone
                    name="photos"
                    maxFiles={MAX_PHOTOS_PER_UPLOAD}
                    maxBytes={MAX_PHOTO_BYTES}
                    accept="image/jpeg,image/png,image/webp"
                    extensionPattern={/\.(jpe?g|png|webp)$/i}
                    extensionError="is not a supported image type (JPEG, PNG, or WebP)."
                    buttonLabel="Choose photos"
                    hint={`or drop them here — JPEG, PNG or WebP, up to ${MAX_PHOTOS_PER_UPLOAD} at a time`}
                    onChange={(files) => {
                      setPhotoFileCount(files.length);
                      setPhotoTotalBytes(files.reduce((sum, file) => sum + file.size, 0));
                    }}
                  />
                  <UploadProgress
                    pending={!!addPhotosSubmission.pending}
                    totalBytes={photoTotalBytes()}
                    label={`Uploading ${photoFileCount()} photo${photoFileCount() === 1 ? "" : "s"} (${formatBytes(photoTotalBytes())})…`}
                  />
                  <Show when={addPhotosSubmission.result instanceof Error}>
                    <p role="alert" class="mt-2 text-sm" style={{ color: "#e03131" }}>
                      {(addPhotosSubmission.result as Error).message}
                    </p>
                  </Show>
                  <Show
                    when={
                      !(addPhotosSubmission.result instanceof Error) &&
                      (addPhotosSubmission.result as AddPhotosResult | undefined)?.inference
                    }
                  >
                    {(inference) => (
                      <p
                        class="mt-2 rounded-lg px-3 py-2 text-xs"
                        style={{
                          background:
                            inference().confidence < 0.6 ? "#fff3bf" : "var(--surface-raised)",
                        }}
                      >
                        Placed using an inferred camera offset of{" "}
                        <strong>{formatOffset(inference().offsetMinutes)}</strong> —{" "}
                        {Math.round(inference().confidence * 100)}% of the batch matched the
                        track's time span. Select photos below and shift their time if that looks
                        wrong.
                      </p>
                    )}
                  </Show>
                  <button
                    type="submit"
                    class="btn btn-secondary mt-3"
                    disabled={addPhotosSubmission.pending || photoFileCount() === 0}
                  >
                    {addPhotosSubmission.pending ? "Processing…" : "Upload photos"}
                  </button>
                </form>

                <Show when={route().photos.length > 0}>
                  <div class="mt-4">
                    <div class="card mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg px-3 py-2 text-xs">
                      <button
                        type="button"
                        class="btn btn-ghost !min-h-0 px-2 py-1"
                        onClick={() => selectAllPhotos(route().photos.map((p) => p.id))}
                      >
                        Select all {route().photos.length}
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost !min-h-0 px-2 py-1"
                        disabled={selectedPhotos().size === 0}
                        onClick={() => setSelectedPhotos(new Set())}
                      >
                        Clear
                      </button>
                      <span class="ink-muted">{selectedPhotos().size} selected</span>
                      <span class="ink-muted ml-auto">Shift time:</span>
                      <button
                        type="button"
                        class="btn btn-ghost !min-h-0 px-2 py-1"
                        disabled={selectedPhotos().size === 0}
                        onClick={() => applyTimeNudge(route().id, -60)}
                      >
                        −1h
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost !min-h-0 px-2 py-1"
                        disabled={selectedPhotos().size === 0}
                        onClick={() => applyTimeNudge(route().id, -15)}
                      >
                        −15m
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost !min-h-0 px-2 py-1"
                        disabled={selectedPhotos().size === 0}
                        onClick={() => applyTimeNudge(route().id, 15)}
                      >
                        +15m
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost !min-h-0 px-2 py-1"
                        disabled={selectedPhotos().size === 0}
                        onClick={() => applyTimeNudge(route().id, 60)}
                      >
                        +1h
                      </button>
                    </div>

                    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                      <For each={route().photos}>
                        {(photo) => (
                          <div class="card rounded-lg p-2">
                            <label class="relative block cursor-pointer">
                              <input
                                type="checkbox"
                                class="absolute left-1.5 top-1.5 z-10 h-4 w-4"
                                checked={selectedPhotos().has(photo.id)}
                                onChange={() => togglePhotoSelected(photo.id)}
                              />
                              <Show when={photo.positionSource === "gps"}>
                                <span
                                  class="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/60 px-1.5 py-0.5 text-[0.625rem] font-semibold text-white"
                                  title="Position from GPS — won't move if this photo's time is shifted"
                                >
                                  GPS
                                </span>
                              </Show>
                              <img
                                src={photo.thumbUrl}
                                alt={photo.caption ?? ""}
                                class="aspect-square w-full rounded-md object-cover"
                              />
                              <span class="tabular absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[0.625rem] text-white">
                                {photo.takenAt ? formatTime(new Date(photo.takenAt)) : "No time"}
                              </span>
                            </label>
                            <form
                              action={updatePhotoCaptionAction}
                              method="post"
                              class="mt-1.5 flex gap-1"
                            >
                              <input type="hidden" name="routeId" value={route().id} />
                              <input type="hidden" name="photoId" value={photo.id} />
                              <input
                                name="caption"
                                class="field !min-h-0 flex-1 px-2 py-1 text-xs"
                                value={photo.caption ?? ""}
                                placeholder="Caption"
                                maxlength="200"
                              />
                              <button
                                type="submit"
                                class="btn btn-ghost !min-h-0 px-2 py-1 text-xs"
                              >
                                Save
                              </button>
                            </form>
                            <button
                              type="button"
                              class="btn btn-danger !min-h-0 mt-1.5 w-full px-2 py-1 text-xs"
                              onClick={() => confirmRemovePhoto(route().id, photo.id)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </section>
            </main>

            <ConfirmDialog request={pendingConfirm()} onCancel={() => setPendingConfirm(null)} />
          </>
        )}
      </Show>
    </Suspense>
  );
}
