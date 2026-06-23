import { describe, expect, it } from "vitest";
import { authorQueryKey, buildAuthorQueryMarkerPattern } from "./AuthorQueryMarker";

describe("authorQueryKey", () => {
	it("collapses whitespace in the question so it matches the parser's cleaned value", () => {
		expect(authorQueryKey("Book/Scene.md", "  Is this   abrupt? ")).toBe("Book/Scene.md::Is this abrupt?");
	});

	it("is stable for the same note + question", () => {
		expect(authorQueryKey("a.md", "Q?")).toBe(authorQueryKey("a.md", "Q?"));
		expect(authorQueryKey("a.md", "Q?")).not.toBe(authorQueryKey("b.md", "Q?"));
	});
});

describe("buildAuthorQueryMarkerPattern", () => {
	it("strips exactly the matching %%ai:%% marker, leaving prose and other markers", () => {
		const note = "Before %%ai: Is this abrupt?%% after %%ai: Other question?%% end.";
		const pattern = buildAuthorQueryMarkerPattern("Is this abrupt?");
		const stripped = note.replace(pattern, "");
		expect(stripped).not.toContain("Is this abrupt?");
		expect(stripped).toContain("%%ai: Other question?%%");
		expect(stripped).toContain("Before ");
		expect(stripped).toContain("after ");
	});

	it("matches the marker even when it wraps across lines (loose whitespace)", () => {
		const note = "x %%ai:\n  Should the   motif\n  return here?\n%% y";
		const pattern = buildAuthorQueryMarkerPattern("Should the motif return here?");
		expect(note.replace(pattern, "").trim()).toBe("x  y");
	});

	it("is case-insensitive on the ai: prefix", () => {
		const pattern = buildAuthorQueryMarkerPattern("Keep?");
		expect("a %% AI : Keep? %% b".replace(pattern, "")).toBe("a  b");
	});

	it("does not match a different question", () => {
		const pattern = buildAuthorQueryMarkerPattern("Question one?");
		const note = "%%ai: Question two?%%";
		expect(note.replace(pattern, "")).toBe(note);
	});
});
