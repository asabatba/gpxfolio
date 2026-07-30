import { Title } from "@solidjs/meta";
import { A, useSubmission } from "@solidjs/router";
import { createSignal, Show } from "solid-js";
import SiteHeader from "~/components/SiteHeader";
import UploadDropzone from "~/components/UploadDropzone";
import { createRouteAction } from "~/lib/actions";

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;

export default function NewRoute() {
  const submission = useSubmission(createRouteAction);
  const [fileCount, setFileCount] = createSignal(0);

  return (
    <>
      <Title>New route</Title>
      <SiteHeader siteName="New route">
        <A href="/admin" class="btn btn-ghost text-sm">
          Cancel
        </A>
      </SiteHeader>

      <main class="mx-auto w-full max-w-2xl px-4 pb-16 sm:px-6">
        <div class="py-6">
          <h1 class="text-2xl font-semibold tracking-tight">Create a shareable route</h1>
          <p class="ink-muted mt-1 text-sm">
            Upload one GPX file, or several to combine them into a single page.
          </p>
        </div>

        <form
          action={createRouteAction}
          method="post"
          enctype="multipart/form-data"
          class="flex flex-col gap-5"
        >
          <UploadDropzone
            name="files"
            maxFiles={MAX_FILES}
            maxBytes={MAX_BYTES}
            onChange={(files) => setFileCount(files.length)}
          />

          <div>
            <label class="label" for="title">
              Title
            </label>
            <input
              id="title"
              name="title"
              class="field"
              placeholder="Dolomites, day 2"
              required
              maxlength="120"
            />
          </div>

          <div>
            <label class="label" for="description">
              Description <span class="font-normal">(optional)</span>
            </label>
            <textarea
              id="description"
              name="description"
              class="field resize-y"
              rows="3"
              placeholder="How it went, what to watch out for…"
              maxlength="2000"
            />
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label" for="activityType">
                Activity <span class="font-normal">(optional)</span>
              </label>
              <input
                id="activityType"
                name="activityType"
                class="field"
                placeholder="Ride, Hike, Run…"
                list="activity-suggestions"
                maxlength="40"
              />
              <datalist id="activity-suggestions">
                <option value="Ride" />
                <option value="Gravel" />
                <option value="MTB" />
                <option value="Run" />
                <option value="Trail" />
                <option value="Hike" />
                <option value="Walk" />
                <option value="Ski" />
              </datalist>
            </div>

            <div>
              <label class="label" for="visibility">
                Visibility
              </label>
              <select id="visibility" name="visibility" class="field">
                <option value="unlisted">Unlisted — only people with the link</option>
                <option value="public">Public — also listed on the homepage</option>
              </select>
            </div>
          </div>

          <Show when={submission.result instanceof Error}>
            <p role="alert" class="text-sm" style={{ color: "#e03131" }}>
              {(submission.result as Error).message}
            </p>
          </Show>

          <div class="flex items-center gap-3">
            <button
              type="submit"
              class="btn btn-primary"
              disabled={submission.pending || fileCount() === 0}
            >
              {submission.pending ? "Processing GPX…" : "Create route"}
            </button>
            <Show when={submission.pending}>
              <span class="ink-muted text-xs">
                Parsing, computing stats and compressing the track.
              </span>
            </Show>
          </div>
        </form>
      </main>
    </>
  );
}
