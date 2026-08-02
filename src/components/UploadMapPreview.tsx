import { clientOnly } from "@solidjs/start";
import { createEffect, createSignal, For, Show } from "solid-js";
import MapSkeleton from "~/components/MapSkeleton";
import type { PreviewTrack } from "~/components/PreviewMap";
import { TRACK_COLORS } from "~/lib/gpx/colors";
import { parseGpx } from "~/lib/gpx/parse";
import { DEFAULT_TOLERANCE_M, simplifyToBudget } from "~/lib/gpx/simplify";
import { GpxParseError } from "~/lib/gpx/types";

const PreviewMap = clientOnly(() => import("~/components/PreviewMap"));

/**
 * Far below the server's 6000-point storage budget (see simplify.ts): this
 * renders into a ~200px box, not a page a viewer will zoom into, so a much
 * coarser line is visually indistinguishable while staying cheap to parse.
 */
const PREVIEW_MAX_POINTS = 800;

interface FileError {
  filename: string;
  message: string;
}

interface UploadMapPreviewProps {
  files: File[];
}

/**
 * Parses the selected GPX files entirely in the browser — reusing the same
 * parser and simplifier the server uses — and draws them on a small map, so
 * whoever's uploading can confirm it's the right route before submitting.
 *
 * Purely a client-side preview: the server independently re-parses and
 * re-validates every file on submit, and its result is what actually gets
 * saved. A file that fails to preview here doesn't block the form — it's
 * reported inline, but the submit button stays enabled and the server has
 * the final word.
 *
 * A GPX file can contain several `<trk>` elements; each becomes its own
 * track/colour here, in the same order `routes.server.ts` assigns them on
 * save, so the preview's colours match what the route ends up looking like.
 */
export default function UploadMapPreview(props: UploadMapPreviewProps) {
  const [tracks, setTracks] = createSignal<PreviewTrack[]>([]);
  const [errors, setErrors] = createSignal<FileError[]>([]);
  const [loading, setLoading] = createSignal(false);

  // Bumped on every files change so a slow parse from a superseded selection
  // can't overwrite the result of a newer one that finished first.
  let generation = 0;

  createEffect(() => {
    const files = props.files;
    const current = ++generation;

    if (files.length === 0) {
      setTracks([]);
      setErrors([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    (async () => {
      const nextTracks: PreviewTrack[] = [];
      const nextErrors: FileError[] = [];

      for (const file of files) {
        let xml: string;
        try {
          xml = await file.text();
        } catch {
          nextErrors.push({ filename: file.name, message: "couldn't be read." });
          continue;
        }
        if (current !== generation) return;

        try {
          const parsed = parseGpx(xml);
          for (const track of parsed.tracks) {
            const { indices } = simplifyToBudget(
              track.points,
              DEFAULT_TOLERANCE_M,
              PREVIEW_MAX_POINTS,
            );
            nextTracks.push({
              id: `track-${nextTracks.length}`,
              color: TRACK_COLORS[nextTracks.length % TRACK_COLORS.length],
              coordinates: indices.map(
                (index) => [track.points[index].lon, track.points[index].lat] as [number, number],
              ),
            });
          }
        } catch (cause) {
          nextErrors.push({
            filename: file.name,
            message: cause instanceof GpxParseError ? cause.message : "couldn't be parsed.",
          });
        }
      }

      if (current !== generation) return;
      setTracks(nextTracks);
      setErrors(nextErrors);
      setLoading(false);
    })();
  });

  return (
    <Show when={props.files.length > 0}>
      <div>
        <Show when={loading() || tracks().length > 0}>
          <div class="h-[200px] w-full overflow-hidden rounded-xl border border-subtle">
            <Show when={!loading()} fallback={<MapSkeleton class="h-full w-full" />}>
              <PreviewMap tracks={tracks()} class="h-full w-full" />
            </Show>
          </div>
        </Show>
        <Show when={errors().length > 0}>
          <ul class="mt-2 flex flex-col gap-1">
            <For each={errors()}>
              {(fileError) => (
                <li role="alert" class="text-xs" style={{ color: "#e03131" }}>
                  Couldn't preview {fileError.filename}: {fileError.message}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}
