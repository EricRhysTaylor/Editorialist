import { describe, expect, it } from "vitest";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { SuggestionParser } from "./SuggestionParser";

function makeParser(): SuggestionParser {
	return new SuggestionParser(new ContributorDirectory());
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

	it("parses an optional SceneId on a MEMO into routing", () => {
		const parser = makeParser();
		const note = fenced([
			"Reviewer: Caroline",
			"ReviewerType: ai",
			"",
			"=== MEMO ===",
			"SceneId: scn_5b1e6328",
			"Issues: Scene-scoped concern.",
			"",
			"=== MEMO ===",
			"Strengths: Manuscript-wide praise.",
		].join("\n"));

		const parsed = parser.parse(note);
		expect(parsed.memos).toHaveLength(2);
		expect(parsed.memos[0].routing?.sceneId).toBe("scn_5b1e6328");
		expect(parsed.memos[1].routing).toBeUndefined();
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

describe("SuggestionParser — CONDENSE anchors", () => {
	function condenseNote(targetLine: string): string {
		return fenced([
			"Reviewer: Caroline",
			"ReviewerType: ai",
			"",
			"=== CONDENSE ===",
			"SceneId: scn_test",
			`Target: ${targetLine}`,
			"Suggestion: tighter beat",
			"Why: drag",
		].join("\n"));
	}

	it("parses a quoted opening → closing anchor pair", () => {
		const parsed = makeParser().parse(condenseNote("\"She wonders, briefly\" → \"isn't reaching her.\""));
		expect(parsed.suggestions).toHaveLength(1);
		const s = parsed.suggestions[0];
		expect(s.operation).toBe("condense");
		if (s.operation !== "condense") return;
		expect(s.payload.targetAnchors).toEqual({
			start: "She wonders, briefly",
			end: "isn't reaching her.",
		});
	});

	it("accepts ASCII -> as the arrow", () => {
		const parsed = makeParser().parse(condenseNote("\"opening fragment\" -> \"closing fragment\""));
		const s = parsed.suggestions[0];
		expect(s.operation).toBe("condense");
		if (s.operation !== "condense") return;
		expect(s.payload.targetAnchors).toEqual({ start: "opening fragment", end: "closing fragment" });
	});

	it("accepts single-quoted anchors", () => {
		const parsed = makeParser().parse(condenseNote("'opening' → 'closing'"));
		const s = parsed.suggestions[0];
		expect(s.operation).toBe("condense");
		if (s.operation !== "condense") return;
		expect(s.payload.targetAnchors).toEqual({ start: "opening", end: "closing" });
	});

	it("leaves targetAnchors undefined for legacy descriptive Target text", () => {
		const parsed = makeParser().parse(condenseNote("The two paragraphs where she wonders why she hasn't been rescued."));
		const s = parsed.suggestions[0];
		expect(s.operation).toBe("condense");
		if (s.operation !== "condense") return;
		expect(s.payload.targetAnchors).toBeUndefined();
		expect(s.payload.target).toContain("she wonders");
	});
});

describe("SuggestionParser — EXPAND", () => {
	function expandNote(lines: string[]): string {
		return fenced(["Reviewer: Mara", "ReviewerType: beta-reader", "", ...lines].join("\n"));
	}

	it("parses a direct expand (Suggestion present) as executionMode 'direct'", () => {
		const parsed = makeParser().parse(
			expandNote([
				"=== EXPAND ===",
				"SceneId: scn_12345678",
				"Target: She looked away and said nothing.",
				"Suggestion: She looked away, jaw tightening, and let the silence stretch before she said nothing.",
				"Why: The emotional turn feels summarized.",
			]),
		);
		expect(parsed.suggestions).toHaveLength(1);
		const s = parsed.suggestions[0];
		expect(s.operation).toBe("expand");
		if (s.operation !== "expand") return;
		expect(s.executionMode).toBe("direct");
		expect(s.payload.target).toBe("She looked away and said nothing.");
		expect(s.payload.suggestion).toContain("let the silence stretch");
		expect(s.routing?.sceneId).toBe("scn_12345678");
	});

	it("parses an advisory expand (no Suggestion) as executionMode 'advisory'", () => {
		const parsed = makeParser().parse(
			expandNote([
				"=== EXPAND ===",
				"Target: She looked away and said nothing.",
				"Why: Slow this beat down with more internal reaction.",
			]),
		);
		expect(parsed.suggestions).toHaveLength(1);
		const s = parsed.suggestions[0];
		expect(s.operation).toBe("expand");
		if (s.operation !== "expand") return;
		expect(s.executionMode).toBe("advisory");
		expect(s.payload.suggestion).toBeUndefined();
	});

	it("drops an expand entry with no Target", () => {
		const parsed = makeParser().parse(expandNote(["=== EXPAND ===", "Why: no target supplied"]));
		expect(parsed.suggestions).toHaveLength(0);
	});
});

describe("SuggestionParser — QUERY section", () => {
	it("parses a query into a kind:\"query\" memo with question/answer/recommendation", () => {
		const parser = makeParser();
		const note = fenced([
			"Reviewer: Caroline",
			"ReviewerType: ai",
			"",
			"=== QUERY ===",
			"Id: Q1",
			"SceneId: scn_abc123",
			"Question: Is this beat too abrupt after the reveal?",
			"Answer: Yes — give Trisan one more line before the cut so the reveal lands.",
			"Recommendation: Add a beat of silence, then her reaction.",
		].join("\n"));

		const parsed = parser.parse(note);
		expect(parsed.suggestions).toHaveLength(0);
		expect(parsed.memos).toHaveLength(1);
		const query = parsed.memos[0];
		expect(query.kind).toBe("query");
		expect(query.question).toContain("too abrupt");
		expect(query.answer).toContain("one more line");
		expect(query.recommendation).toContain("beat of silence");
		expect(query.routing?.sceneId).toBe("scn_abc123");
	});

	it("routes a query by SceneId and coexists with memos and edits", () => {
		const parser = makeParser();
		const note = fenced([
			"Reviewer: Caroline",
			"ReviewerType: ai",
			"",
			"=== MEMO ===",
			"Issues: Watch the pacing in the back half.",
			"",
			"=== QUERY ===",
			"Id: Q1",
			"SceneId: scn_xyz",
			"Question: Should the bridge motif return here?",
			"Answer: No — it would over-signal. Leave it implied.",
			"",
			"=== EDIT ===",
			"Original: He sat down.",
			"Revised: He sank into the chair.",
		].join("\n"));

		const parsed = parser.parse(note);
		expect(parsed.suggestions).toHaveLength(1);
		expect(parsed.memos).toHaveLength(2);
		const kinds = parsed.memos.map((m) => m.kind).sort();
		expect(kinds).toEqual(["memo", "query"]);
		const query = parsed.memos.find((m) => m.kind === "query");
		expect(query?.routing?.sceneId).toBe("scn_xyz");
	});

	it("drops a query that has a question but no answer", () => {
		const parser = makeParser();
		const note = fenced(
			["=== QUERY ===", "Id: Q1", "SceneId: scn_x", "Question: Is this abrupt?"].join("\n"),
		);
		expect(parser.parse(note).memos).toHaveLength(0);
	});

	it("keeps a query with an answer but no Id", () => {
		const parser = makeParser();
		const note = fenced(
			["=== QUERY ===", "SceneId: scn_x", "Question: Is this abrupt?", "Answer: No, it lands."].join("\n"),
		);
		const memos = parser.parse(note).memos;
		expect(memos).toHaveLength(1);
		expect(memos[0].kind).toBe("query");
		expect(memos[0].answer).toContain("it lands");
	});
});
