import { describe, expect, it } from "vitest";
import { buildSlug, generateId, slugifyTitle } from "./ids";

describe("slugifyTitle", () => {
  it("strips diacritics rather than dropping the letters", () => {
    expect(slugifyTitle("Vall d'Aran, Pyrénées")).toBe("vall-d-aran-pyrenees");
    expect(slugifyTitle("Åre — Sölden")).toBe("are-solden");
  });

  it("collapses punctuation and trims separators", () => {
    expect(slugifyTitle("  Dolomites // Day 2!  ")).toBe("dolomites-day-2");
  });

  it("never ends in a separator, even when truncated", () => {
    const slug = slugifyTitle(`${"a".repeat(58)}   tail`);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it("returns an empty string for titles with no usable characters", () => {
    expect(slugifyTitle("###")).toBe("");
    expect(slugifyTitle("")).toBe("");
  });
});

describe("generateId", () => {
  it("uses only unambiguous base32 characters", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateId()).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{12}$/);
    }
  });

  it("respects the requested length", () => {
    expect(generateId(8)).toHaveLength(8);
    expect(generateId(20)).toHaveLength(20);
  });

  it("does not repeat across many draws", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateId()));
    expect(seen.size).toBe(2000);
  });
});

describe("buildSlug", () => {
  it("prefixes a random id so identical titles never collide", () => {
    const a = buildSlug("Dolomites Day 2");
    const b = buildSlug("Dolomites Day 2");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{8}-dolomites-day-2$/);
  });

  it("falls back to just the random id when the title has no usable characters", () => {
    expect(buildSlug("!!!")).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{8}$/);
  });
});
