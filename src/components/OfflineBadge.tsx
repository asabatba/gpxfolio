import { Show } from "solid-js";
import { createOnlineSignal } from "~/lib/online-status";

/**
 * Renders nothing while online. The whole point of the offline caching is
 * invisible-by-default (a visited route just keeps working), but silence
 * offline is confusing: a viewer with no signal looking at a route page
 * should know they're seeing last-cached data, not assume something's
 * broken. Styled after `SiteHeader`'s own "Admin" pill.
 */
export default function OfflineBadge() {
  const offline = createOnlineSignal();
  return (
    <Show when={offline()}>
      <span
        class="ink-muted flex items-center gap-1.5 rounded-full border border-subtle px-2.5 py-1 text-xs font-medium"
        title="No connection — showing the last cached version of this page"
      >
        <span
          class="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ "background-color": "var(--ink-muted)" }}
          aria-hidden="true"
        />
        Offline
      </span>
    </Show>
  );
}
