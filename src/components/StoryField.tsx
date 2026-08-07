import { createSignal, Show } from "solid-js";
import { renderStory } from "~/lib/story";

/**
 * A Markdown textarea with a toggleable rendered preview, for the route
 * edit form's trip-story field.
 *
 * The textarea and the preview are mutually exclusive in the DOM — toggling
 * swaps one for the other rather than showing both — so a hidden input
 * carries the current text across the swap and is what the form actually
 * submits.
 */
export default function StoryField(props: { id: string; name: string; initialValue: string }) {
  const [text, setText] = createSignal(props.initialValue);
  const [previewing, setPreviewing] = createSignal(false);

  return (
    <div>
      <div class="mb-1 flex items-center justify-between">
        <label class="label !mb-0" for={props.id}>
          Trip story
        </label>
        <button
          type="button"
          class="btn btn-ghost !min-h-0 px-2 py-1 text-xs"
          onClick={() => setPreviewing((p) => !p)}
        >
          {previewing() ? "Edit" : "Preview"}
        </button>
      </div>

      <input type="hidden" name={props.name} value={text()} />

      <Show
        when={!previewing()}
        fallback={
          <Show
            when={text().trim()}
            fallback={<p class="field ink-muted min-h-[10rem] text-sm">Nothing to preview yet.</p>}
          >
            {(markdown) => (
              <div
                class="field prose-story min-h-[10rem] text-sm leading-relaxed"
                innerHTML={renderStory(markdown())}
              />
            )}
          </Show>
        }
      >
        <textarea
          id={props.id}
          class="field resize-y"
          rows="8"
          maxlength="20000"
          value={text()}
          placeholder="How did it go? Markdown formatting (bold, lists, headers) is supported."
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </Show>
    </div>
  );
}
