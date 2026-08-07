import MarkdownIt from "markdown-it";

/**
 * Renders a route's trip-story field to sanitised HTML.
 *
 * `html: false` (the default) means raw `<tag>`s in the source are escaped
 * rather than passed through — the only admin writes this, but it's rendered
 * to public viewers, so there's no reason to allow an HTML-injection surface
 * for a feature that doesn't need one. `breaks: true` turns a single Enter
 * into a line break: CommonMark otherwise requires a blank line between
 * paragraphs, which is a foot-gun for prose typed by someone who isn't
 * thinking about Markdown syntax as they write.
 */
const md = new MarkdownIt({ breaks: true, linkify: true });

export function renderStory(markdown: string): string {
  return md.render(markdown);
}
