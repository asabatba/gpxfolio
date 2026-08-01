import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { isServer } from "solid-js/web";

interface UploadProgressProps {
  pending: boolean;
  /** Total size of the selected files, used only to scale the animation's pacing. */
  totalBytes: number;
  label: string;
}

/** A conservative home-upload estimate: fast enough that small batches don't crawl, slow enough that large ones don't finish animating long before the network does. */
const ASSUMED_BYTES_PER_MS = 1.5 * 1024;

/**
 * An estimated — not byte-accurate — progress bar for uploads submitted
 * through a SolidStart action.
 *
 * Actions transport over `fetch`, which (unlike `XMLHttpRequest`) exposes no
 * upload-progress event; getting real byte progress would mean bypassing the
 * action mechanism and hand-reimplementing its response protocol, which is
 * far too fragile for what this is. Instead the bar eases toward 92% over a
 * duration scaled to the payload size, then jumps to 100% and fades out the
 * moment the action actually resolves — it reads as "working," not as a
 * precise percentage.
 */
export default function UploadProgress(props: UploadProgressProps) {
  const [progress, setProgress] = createSignal(0);
  const [visible, setVisible] = createSignal(false);
  let frame: number | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let startedAt = 0;

  function tick() {
    const elapsed = performance.now() - startedAt;
    const estimatedMs = Math.max(900, props.totalBytes / ASSUMED_BYTES_PER_MS);
    const ratio = 1 - Math.exp(-elapsed / (estimatedMs / 3));
    setProgress(Math.min(92, ratio * 92));
    if (props.pending) frame = requestAnimationFrame(tick);
  }

  // `pending` only ever becomes true from a real browser form submission, so
  // this never actually fires during SSR — but the effect (and its cleanup)
  // still *runs* as part of SSR's render/teardown, and requestAnimationFrame
  // doesn't exist in Node. Guard explicitly rather than relying on that.
  createEffect(() => {
    if (isServer) return;
    if (props.pending) {
      clearTimeout(hideTimer);
      cancelAnimationFrame(frame ?? -1);
      setVisible(true);
      startedAt = performance.now();
      setProgress(0);
      frame = requestAnimationFrame(tick);
    } else if (visible()) {
      cancelAnimationFrame(frame ?? -1);
      setProgress(100);
      hideTimer = setTimeout(() => setVisible(false), 600);
    }
  });

  onCleanup(() => {
    if (isServer) return;
    cancelAnimationFrame(frame ?? -1);
    clearTimeout(hideTimer);
  });

  return (
    <Show when={visible()}>
      <div
        class="mt-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress())}
        aria-label={props.label}
      >
        <p class="ink-muted mb-1 text-xs">{props.label}</p>
        <div
          class="h-1.5 w-full overflow-hidden rounded-full"
          style={{ "background-color": "var(--surface-sunken)" }}
        >
          <div
            class="h-full rounded-full transition-[width] duration-200 ease-out"
            style={{ width: `${progress()}%`, "background-color": "var(--accent)" }}
          />
        </div>
      </div>
    </Show>
  );
}
