import { createSignal, Show } from "solid-js";

interface ShareButtonProps {
  title: string;
  class?: string;
}

/**
 * Uses the Web Share API where available (the native sheet on phones, which is
 * the main way these links get sent) and falls back to copying the URL.
 */
export default function ShareButton(props: ShareButtonProps) {
  const [copied, setCopied] = createSignal(false);
  const [failed, setFailed] = createSignal(false);

  async function share() {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title: props.title, url });
        return;
      } catch (error) {
        // A user dismissing the share sheet throws AbortError; that isn't a
        // failure and must not fall through to the clipboard path.
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
      setTimeout(() => setFailed(false), 3000);
    }
  }

  return (
    <button
      type="button"
      class={`btn btn-secondary ${props.class ?? ""}`}
      onClick={share}
      aria-live="polite"
    >
      <Show
        when={!copied() && !failed()}
        fallback={<span>{copied() ? "Link copied" : "Copy failed"}</span>}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M8.7 13.3a4 4 0 0 0 6 .4l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M15.3 10.7a4 4 0 0 0-6-.4l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
          />
        </svg>
        <span>Share</span>
      </Show>
    </button>
  );
}
