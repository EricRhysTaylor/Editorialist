import { describe, it, expect } from "vitest";
import { findFuzzyMatches } from "./TextMatching";

describe("findFuzzyMatches", () => {
  it("matches across straight vs curly apostrophes", () => {
    const note = "An hour passes, and she reluctantly decides the IT isn't coming.";
    const target = "An hour passes, and she reluctantly decides the IT isn’t coming.";
    const ranges = findFuzzyMatches(note, target);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.startOffset).toBe(0);
    expect(ranges[0]?.endOffset).toBe(note.length);
  });

  it("matches across em-dash vs hyphen (single char each)", () => {
    const note = "fail in sequence - too clean, too fast.";
    const target = "fail in sequence — too clean, too fast.";
    const ranges = findFuzzyMatches(note, target);
    expect(ranges).toHaveLength(1);
  });

  it("matches across whitespace differences (line wraps vs single space)", () => {
    const note = "She wonders\nwhere the IT are.";
    const target = "She wonders where the IT are.";
    const ranges = findFuzzyMatches(note, target);
    expect(ranges).toHaveLength(1);
  });

  it("returns no matches when text is genuinely absent", () => {
    const note = "Some completely different prose.";
    const target = "An hour passes.";
    const ranges = findFuzzyMatches(note, target);
    expect(ranges).toHaveLength(0);
  });
});
