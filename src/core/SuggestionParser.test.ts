import { describe, expect, it } from "vitest";
import { ReviewerDirectory } from "../state/ReviewerDirectory";
import { SuggestionParser } from "./SuggestionParser";

function makeParser(): SuggestionParser {
	return new SuggestionParser(new ReviewerDirectory());
}

function fenced(body: string): string {
	return "```editorialist-review\n" + body + "\n```";
}

describe("SuggestionParser — MEMO section", () => {
	it("extracts a memo with strengths + issues fields", () => {
		const parser = makeParser();
		const note = fenced([
			"Reviewer: Caroline",
			"ReviewerType: ai",
			"Provider: anthropic",
			"Model: claude-4.7",
			"",
			"=== MEMO ===",
			"Strengths:",
			"The opening hook lands cleanly. Trisan's voice is distinct.",
			"",
			"Issues:",
			"The midpoint loses momentum across three consecutive interior",
			"monologue beats. The therapist disappears as a character.",
			"",
			"=== EDIT ===",
			"Original: He sat down quietly.",
			"Revised: He lowered himself into the chair without a word.",
			"Why: tighter cadence",
		].join("\n"));

		const parsed = parser.parse(note);
		expect(parsed.memos).toHaveLength(1);
		const memo = parsed.memos[0];
		expect(memo.strengths).toContain("opening hook lands cleanly");
		expect(memo.issues).toContain("midpoint loses momentum");
		expect(memo.body).toBeUndefined();
		expect(memo.contributor).toBeDefined();
		expect(memo.contributor.reviewerType).toMatch(/ai/);
		expect(parsed.suggestions).toHaveLength(1);
		expect(parsed.suggestions[0].operation).toBe("edit");
	});

	it("treats a freeform memo body (no Strengths/Issues fields) as body text", () => {
		const parser = makeParser();
		const note = fenced([
			"Reviewer: Maria",
			"ReviewerType: human",
			"",
			"=== MEMO ===",
			"This scene reads beautifully but the climactic exchange",
			"feels rushed compared to the rest of the chapter.",
		].join("\n"));

		const parsed = parser.parse(note);
		expect(parsed.memos).toHaveLength(1);
		const memo = parsed.memos[0];
		expect(memo.strengths).toBeUndefined();
		expect(memo.issues).toBeUndefined();
		expect(memo.body).toContain("reads beautifully");
		expect(parsed.suggestions).toHaveLength(0);
	});

	it("produces an empty memos array when no MEMO section is present", () => {
		const parser = makeParser();
		const note = fenced([
			"Reviewer: Caroline",
			"=== EDIT ===",
			"Original: a",
			"Revised: b",
		].join("\n"));

		const parsed = parser.parse(note);
		expect(parsed.memos).toEqual([]);
		expect(parsed.suggestions).toHaveLength(1);
	});

	it("supports memo-only review blocks (no operations)", () => {
		const parser = makeParser();
		const note = fenced([
			"Reviewer: Caroline",
			"ReviewerType: ai",
			"",
			"=== MEMO ===",
			"Strengths: The pacing works.",
			"Issues: The voice slips on page 3.",
		].join("\n"));

		const parsed = parser.parse(note);
		expect(parsed.suggestions).toEqual([]);
		expect(parsed.memos).toHaveLength(1);
		expect(parsed.blockCount).toBe(1);
	});

	it("captures multiple memos from multiple review blocks", () => {
		const parser = makeParser();
		const note = [
			fenced([
				"Reviewer: Caroline",
				"=== MEMO ===",
				"Strengths: Tight prose.",
			].join("\n")),
			"",
			fenced([
				"Reviewer: Maria",
				"=== MEMO ===",
				"Issues: Pacing drag mid-scene.",
			].join("\n")),
		].join("\n");

		const parsed = parser.parse(note);
		expect(parsed.memos).toHaveLength(2);
		expect(parsed.memos[0].contributor.displayName).toBe("Caroline");
		expect(parsed.memos[1].contributor.displayName).toBe("Maria");
	});
});
