import { describe, expect, it } from "vitest";
import { renderStory } from "./story";

describe("renderStory", () => {
  it("renders basic Markdown formatting", () => {
    expect(renderStory("**cold** start, *warmed up* by the ridge")).toBe(
      "<p><strong>cold</strong> start, <em>warmed up</em> by the ridge</p>\n",
    );
  });

  it("turns a single line break into <br>, not a new paragraph", () => {
    expect(renderStory("line one\nline two")).toBe("<p>line one<br>\nline two</p>\n");
  });

  it("escapes raw HTML rather than passing it through", () => {
    expect(renderStory('<script>alert("hi")</script>')).not.toContain("<script>");
  });

  it("linkifies bare URLs", () => {
    expect(renderStory("trailhead: https://example.com/map")).toContain(
      '<a href="https://example.com/map">https://example.com/map</a>',
    );
  });
});
