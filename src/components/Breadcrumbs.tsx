import { A } from "@solidjs/router";
import { For } from "solid-js";

export interface Crumb {
  label: string;
  /** Omitted on the last item — that's the current page, not a link. */
  href?: string;
}

/**
 * "Routes / Volta d'Eina / Edit" — a persistent sense of place in the admin
 * flow, alongside (not replacing) the page-specific quick actions
 * (`SiteHeader`'s "Done"/"Cancel"/"View" links), which stay because they do
 * something a breadcrumb can't: jump to the one place you most likely want
 * next rather than just retracing the hierarchy.
 */
export default function Breadcrumbs(props: { items: Crumb[]; class?: string }) {
  return (
    <nav aria-label="Breadcrumb" class={`mx-auto w-full px-4 pt-3 sm:px-6 ${props.class ?? ""}`}>
      <ol class="ink-muted flex flex-wrap items-center gap-1.5 text-xs">
        <For each={props.items}>
          {(item, i) => (
            <>
              <li>
                {item.href ? (
                  <A href={item.href} class="underline-offset-2 hover:underline">
                    {item.label}
                  </A>
                ) : (
                  <span class="ink" aria-current="page">
                    {item.label}
                  </span>
                )}
              </li>
              {i() < props.items.length - 1 && <li aria-hidden="true">/</li>}
            </>
          )}
        </For>
      </ol>
    </nav>
  );
}
