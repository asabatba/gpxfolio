import { createSignal, For, Show } from "solid-js";
import { formatBytes } from "~/lib/format";

interface UploadDropzoneProps {
  name: string;
  maxFiles: number;
  maxBytes: number;
  /** Reports the current selection so the parent can enable/disable submit. */
  onChange?: (files: File[]) => void;
}

/**
 * Drag-and-drop plus a normal file picker.
 *
 * The picker input is kept in the DOM and its `files` set programmatically via a
 * DataTransfer, so dropped files take part in the ordinary form submission
 * instead of needing a separate upload path.
 */
export default function UploadDropzone(props: UploadDropzoneProps) {
  let input!: HTMLInputElement;
  const [files, setFiles] = createSignal<File[]>([]);
  const [dragging, setDragging] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  function validate(candidates: File[]): { accepted: File[]; problem: string | null } {
    const accepted: File[] = [];
    for (const file of candidates) {
      if (!/\.gpx$/i.test(file.name)) {
        return { accepted: [], problem: `${file.name} is not a .gpx file.` };
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

  function apply(candidates: File[]) {
    const { accepted, problem } = validate(candidates);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setFiles(accepted);

    // Mirror the selection back onto the input so the form posts these files.
    const transfer = new DataTransfer();
    for (const file of accepted) transfer.items.add(file);
    input.files = transfer.files;

    props.onChange?.(accepted);
  }

  function removeAt(index: number) {
    apply(files().filter((_, i) => i !== index));
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
          accept=".gpx,application/gpx+xml"
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
          Choose GPX files
        </label>
        <p class="ink-muted mt-2 text-xs">
          or drop them here — up to {props.maxFiles} files, {formatBytes(props.maxBytes)} each
        </p>
      </div>

      <Show when={error()}>
        <p role="alert" class="mt-2 text-sm" style={{ color: "#e03131" }}>
          {error()}
        </p>
      </Show>

      <Show when={files().length > 0}>
        <ul class="mt-3 flex flex-col gap-1.5">
          <For each={files()}>
            {(file, index) => (
              <li class="card flex items-center gap-3 rounded-lg px-3 py-2">
                <span class="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                <span class="ink-muted tabular shrink-0 text-xs">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  class="btn btn-ghost !min-h-0 !min-w-0 shrink-0 px-2 py-1 text-xs"
                  onClick={() => removeAt(index())}
                  aria-label={`Remove ${file.name}`}
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
