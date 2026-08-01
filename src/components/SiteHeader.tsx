import { A, useLocation } from "@solidjs/router";
import { type JSX, Show } from "solid-js";

interface SiteHeaderProps {
  siteName: string;
  /**
   * Whether the current viewer holds an admin session. Passed down from the
   * page's own data query rather than fetched here: `useSession` writes a
   * cookie as a side effect of merely reading it, and doing that from a
   * second, independently-resolving async resource risks losing the race
   * against the SSR shell's headers already having been flushed (crashes
   * with `ERR_HTTP_HEADERS_SENT`). Pages that don't already know — because
   * they run no server query of their own — simply omit it.
   */
  isAdmin?: boolean;
  /** Right-hand slot for page-specific controls. */
  children?: JSX.Element;
}

export default function SiteHeader(props: SiteHeaderProps) {
  const location = useLocation();
  // Every /admin/* page already has its own admin-specific controls (New
  // route, Sign out, Done, ...) passed as children — the generic badge would
  // just be noise there.
  const showBadge = () => props.isAdmin && !location.pathname.startsWith("/admin");

  return (
    <header
      class="surface sticky top-0 z-20 border-b border-subtle"
      style={{ "padding-top": "env(safe-area-inset-top)" }}
    >
      <div class="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <A href="/" class="tap flex items-center gap-2 font-semibold tracking-tight">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" class="shrink-0">
            <path
              d="M3 17.5 8 7l4.5 7.5L15.5 10l5.5 7.5"
              fill="none"
              stroke="var(--accent)"
              stroke-width="2.1"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>
          <span class="truncate">{props.siteName}</span>
        </A>
        <div class="flex items-center gap-1.5">
          {props.children}
          <Show when={showBadge()}>
            <A
              href="/admin"
              class="ink-muted flex items-center gap-1.5 rounded-full border border-subtle px-2.5 py-1 text-xs font-medium"
              title="Signed in as admin"
            >
              <span
                class="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ "background-color": "#2f9e44" }}
                aria-hidden="true"
              />
              Admin
            </A>
          </Show>
        </div>
      </div>
    </header>
  );
}
