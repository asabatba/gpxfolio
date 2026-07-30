import { A } from "@solidjs/router";
import type { JSX } from "solid-js";

interface SiteHeaderProps {
  siteName: string;
  /** Right-hand slot for page-specific controls. */
  children?: JSX.Element;
}

export default function SiteHeader(props: SiteHeaderProps) {
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
        <div class="flex items-center gap-1.5">{props.children}</div>
      </div>
    </header>
  );
}
