import { createEffect } from "solid-js";

export interface PendingConfirm {
  title: string;
  message: string;
  /** Defaults to "Delete" — every current caller confirms a deletion. */
  confirmLabel?: string;
  onConfirm: () => void;
}

interface ConfirmDialogProps {
  /** Null when no confirmation is pending — the dialog stays closed. */
  request: PendingConfirm | null;
  onCancel: () => void;
}

/**
 * Replaces `window.confirm()` for destructive actions (delete a route,
 * remove a track, delete a photo) with a dialog that matches the app's own
 * design system instead of the browser's unstyled, theme-blind default.
 *
 * Built on native `<dialog>`, same as `PhotoGallery`'s lightbox: `showModal()`
 * gives focus-trapping and Escape-to-close for free.
 */
export default function ConfirmDialog(props: ConfirmDialogProps) {
  let dialog!: HTMLDialogElement;

  createEffect(() => {
    if (props.request) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  });

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog's own keydown (Escape) is native; this only adds click-outside-to-close.
    <dialog
      ref={dialog}
      class="m-auto w-[min(90vw,26rem)] rounded-xl bg-transparent p-0 backdrop:bg-black/50"
      onClose={props.onCancel}
      onClick={(event) => {
        if (event.target === dialog) props.onCancel();
      }}
    >
      {props.request && (
        <div class="card rounded-xl p-5">
          <h2 class="text-base font-semibold">{props.request.title}</h2>
          <p class="ink-muted mt-1.5 text-sm">{props.request.message}</p>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="btn btn-ghost" onClick={props.onCancel}>
              Cancel
            </button>
            <button type="button" class="btn btn-danger" onClick={props.request.onConfirm}>
              {props.request.confirmLabel ?? "Delete"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
