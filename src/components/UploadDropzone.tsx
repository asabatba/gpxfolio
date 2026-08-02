import { createSignal, For, Show } from "solid-js";
import { formatBytes, formatDateISO } from "~/lib/format";
import { parseGpx } from "~/lib/gpx/parse";

interface UploadDropzoneProps {
  name: string;
  maxFiles: number;
  maxBytes: number;
  /** Reports the current selection so the parent can enable/disable submit. */
  onChange?: (files: File[]) => void;
  /** `<input accept>` value. Defaults to GPX. */
  accept?: string;
  /** Filename check; a candidate failing this is rejected with `extensionError`. Defaults to `.gpx`. */
  extensionPattern?: RegExp;
  /** Shown when a file fails `extensionPattern`, prefixed with the filename. Defaults to "is not a .gpx file." */
  extensionError?: string;
  /** Button copy. Defaults to "Choose GPX files". */
  buttonLabel?: string;
  /** Hint line under the button; `{max}` files, `{size}` each are filled in for you. Defaults to the GPX copy. */
  hint?: string;
  /**
   * For multi-day trips: parses each file's earliest track timestamp, shows
   * it next to the filename, and sorts the selection by that date (oldest
   * first) so upload order — which becomes stage order — matches trip order
   * without the uploader having to pick files in date order themselves.
   * Files with no timestamp sort last. GPX-only; leave off for photos.
   */
  showGpxDates?: boolean;
}

const GPX_EXTENSION_PATTERN = /\.gpx$/i;

/** Earliest trackpoint timestamp across a GPX file's tracks, or null if untimed/unparseable. */
async function readGpxDate(file: File): Promise<number | null> {
  try {
    const xml = await file.text();
    const starts = parseGpx(xml)
      .tracks.map((track) => track.points[0]?.time)
      .filter((time): time is number => time != null);
    return starts.length > 0 ? Math.min(...starts) : null;
  } catch {
    return null;
  }
}

interface FileEntry {
  file: File;
  /** Earliest trackpoint time, epoch ms; null when unknown or not applicable. */
  date: number | null;
}

/**
 * Drag-and-drop plus a normal file picker.
 *
 * The picker input is kept in the DOM and its `files` set programmatically via a
 * DataTransfer, so dropped files take part in the ordinary form submission
 * instead of needing a separate upload path. Defaults to GPX; pass `accept`/
 * `extensionPattern`/copy props to reuse it for other file types (photos).
 */
export default function UploadDropzone(props: UploadDropzoneProps) {
  let input!: HTMLInputElement;
  const [entries, setEntries] = createSignal<FileEntry[]>([]);
  const [dragging, setDragging] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const extensionPattern = () => props.extensionPattern ?? GPX_EXTENSION_PATTERN;
  const extensionError = () => props.extensionError ?? "is not a .gpx file.";

  // Keyed by File so removing one entry doesn't force re-parsing the rest.
  const dateCache = new Map<File, number | null>();
  // Bumped on every apply() so a slow parse from a superseded selection can't
  // overwrite a newer one that finished first.
  let generation = 0;

  function validate(candidates: File[]): { accepted: File[]; problem: string | null } {
    const accepted: File[] = [];
    for (const file of candidates) {
      if (!extensionPattern().test(file.name)) {
        return { accepted: [], problem: `${file.name} ${extensionError()}` };
      }
      if (file.size > props.maxBytes) {
        return {
          accepted: [],
          problem: `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(props.maxBytes)}.`,
        };
      }
      accepted.push(file);
    }
    if (accepted.length > props.maxFiles) {
      return { accepted: [], problem: `Up to ${props.maxFiles} files at a time.` };
    }
    return { accepted, problem: null };
  }

  function commit(next: FileEntry[]) {
    setEntries(next);

    // Mirror the selection back onto the input so the form posts these files,
    // in the same order shown/sorted here.
    const transfer = new DataTransfer();
    for (const { file } of next) transfer.items.add(file);
    input.files = transfer.files;

    props.onChange?.(next.map((entry) => entry.file));
  }

  async function apply(candidates: File[]) {
    const { accepted, problem } = validate(candidates);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);

    if (!props.showGpxDates) {
      commit(accepted.map((file) => ({ file, date: null })));
      return;
    }

    const current = ++generation;
    const dates = await Promise.all(
      accepted.map(async (file) => {
        const cached = dateCache.get(file);
        if (cached !== undefined) return cached;
        const date = await readGpxDate(file);
        dateCache.set(file, date);
        return date;
      }),
    );
    if (current !== generation) return;

    const next = accepted.map((file, i) => ({ file, date: dates[i] }));
    next.sort((a, b) => {
      if (a.date == null && b.date == null) return 0;
      if (a.date == null) return 1;
      if (b.date == null) return -1;
      return a.date - b.date;
    });
    commit(next);
  }

  function removeAt(index: number) {
    apply(entries()
      .filter((_, i) => i !== index)
      .map((entry) => entry.file));
  }

  return (
    <div>
      <div
        class="rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors"
        style={{
          "border-color": dragging() ? "var(--accent)" : "var(--border-subtle)",
          "background-color": dragging() ? "var(--surface-raised)" : "transparent",
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          apply(Array.from(event.dataTransfer?.files ?? []));
        }}
      >
        <input
          ref={input}
          id={props.name}
          name={props.name}
          type="file"
          accept={props.accept ?? ".gpx,application/gpx+xml"}
          multiple
          class="sr-only"
          onChange={(event) => apply(Array.from(event.currentTarget.files ?? []))}
        />
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          class="mx-auto mb-2"
          aria-hidden="true"
        >
          <path
            d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
            stroke="var(--ink-muted)"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <label for={props.name} class="btn btn-secondary cursor-pointer">
          {props.buttonLabel ?? "Choose GPX files"}
        </label>
        <p class="ink-muted mt-2 text-xs">
          {props.hint ??
            `or drop them here — up to ${props.maxFiles} files, ${formatBytes(props.maxBytes)} each`}
        </p>
      </div>

      <Show when={error()}>
        <p role="alert" class="mt-2 text-sm" style={{ color: "#e03131" }}>
          {error()}
        </p>
      </Show>

      <Show when={entries().length > 0}>
        <ul class="mt-3 flex flex-col gap-1.5">
          <For each={entries()}>
            {(entry, index) => (
              <li class="card flex items-center gap-3 rounded-lg px-3 py-2">
                <span class="min-w-0 flex-1 truncate text-sm">{entry.file.name}</span>
                <Show when={props.showGpxDates}>
                  <span class="ink-muted tabular shrink-0 text-xs">
                    {entry.date != null ? formatDateISO(new Date(entry.date)) : "no date"}
                  </span>
                </Show>
                <span class="ink-muted tabular shrink-0 text-xs">{formatBytes(entry.file.size)}</span>
                <button
                  type="button"
                  class="btn btn-ghost !min-h-0 !min-w-0 shrink-0 px-2 py-1 text-xs"
                  onClick={() => removeAt(index())}
                  aria-label={`Remove ${entry.file.name}`}
                >
                  Remove
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
