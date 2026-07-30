import { createEffect, createMemo, For, Show, type Accessor, type Setter } from "solid-js";
import type { PhotoView } from "~/lib/track-view";

interface PhotoGalleryProps {
  photos: PhotoView[];
  selected: Accessor<string | null>;
  onSelect: Setter<string | null>;
}

/**
 * Responsive thumbnail grid plus a small dependency-free lightbox.
 *
 * Built on `<dialog>` rather than a modal library — MapLibre's markers already
 * use hand-built DOM elements instead of a plugin (see `RouteMap.tsx`), and a
 * lightbox is simple enough to follow the same ethos: `showModal()` gives
 * focus-trapping and Escape-to-close for free, with no extra dependency.
 */
export default function PhotoGallery(props: PhotoGalleryProps) {
  let dialog!: HTMLDialogElement;

  const index = createMemo(() => props.photos.findIndex((p) => p.id === props.selected()));
  const current = createMemo(() => {
    const i = index();
    return i >= 0 ? props.photos[i] : null;
  });

  createEffect(() => {
    if (current()) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  });

  function step(delta: number) {
    const list = props.photos;
    if (list.length === 0) return;
    const next = (((index() + delta) % list.length) + list.length) % list.length;
    props.onSelect(list[next].id);
  }

  return (
    <Show when={props.photos.length > 0}>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        <For each={props.photos}>
          {(photo) => (
            <button
              type="button"
              class="tap aspect-square overflow-hidden rounded-lg border border-subtle"
              onClick={() => props.onSelect(photo.id)}
            >
              <img
                src={photo.thumbUrl}
                alt={photo.caption ?? ""}
                loading="lazy"
                class="h-full w-full object-cover"
              />
            </button>
          )}
        </For>
      </div>

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog's own keydown (Escape) is native; this only adds click-outside-to-close. */}
      <dialog
        ref={dialog}
        class="m-auto max-h-[90vh] max-w-[90vw] rounded-xl bg-transparent p-0 backdrop:bg-black/70"
        onClose={() => props.onSelect(null)}
        onClick={(event) => {
          if (event.target === dialog) props.onSelect(null);
        }}
      >
        <Show when={current()}>
          {(photo) => (
            <figure class="relative m-0 flex max-h-[90vh] flex-col items-center">
              <img
                src={photo().fullUrl}
                alt={photo().caption ?? ""}
                class="max-h-[80vh] max-w-[90vw] rounded-lg object-contain"
              />
              <Show when={photo().caption}>
                <figcaption class="mt-2 max-w-[90vw] px-2 text-center text-sm text-white">
                  {photo().caption}
                </figcaption>
              </Show>

              <button
                type="button"
                class="btn btn-secondary absolute right-2 top-2 !min-h-0 px-2.5 py-1 text-xs"
                onClick={() => props.onSelect(null)}
                aria-label="Close"
              >
                ✕
              </button>

              <Show when={props.photos.length > 1}>
                <button
                  type="button"
                  class="btn btn-secondary absolute left-2 top-1/2 !min-h-0 -translate-y-1/2 px-2.5 py-1.5"
                  onClick={() => step(-1)}
                  aria-label="Previous photo"
                >
                  ‹
                </button>
                <button
                  type="button"
                  class="btn btn-secondary absolute right-2 top-1/2 !min-h-0 -translate-y-1/2 px-2.5 py-1.5"
                  onClick={() => step(1)}
                  aria-label="Next photo"
                >
                  ›
                </button>
              </Show>
            </figure>
          )}
        </Show>
      </dialog>
    </Show>
  );
}
