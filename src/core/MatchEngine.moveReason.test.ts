import { describe, expect, it } from "vitest";
import { MatchEngine } from "./MatchEngine";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { SuggestionParser } from "./SuggestionParser";

function buildMoveSuggestion(target: string, before: string) {
	const parser = new SuggestionParser(new ContributorDirectory());
	const note = `\`\`\`editorialist-review
Reviewer: GPT-5.4
ReviewerType: ai-editor

=== MOVE ===
SceneId: scn_test
Target: ${target}
Before: ${before}
Why: testing
\`\`\``;
	const parsed = parser.parse(note);
	const suggestion = parsed.suggestions[0];
	if (!suggestion || suggestion.operation !== "move") {
		throw new Error("expected one move suggestion");
	}
	return suggestion;
}

describe("MatchEngine — move side-specific failure reasons", () => {
	const noteText = [
		"She recalls from her survivalist training that this is a mark of the Natural Services.",
		"They are known to take their jobs very seriously.",
		"She must proceed cautiously. But this is an emergency.",
	].join("\n");

	it("names the destination when the anchor cannot be found but the source can", () => {
		const suggestion = buildMoveSuggestion(
			"She must proceed cautiously. But this is an emergency.",
			"A passage that does not exist anywhere in the manuscript.",
		);
		const matched = new MatchEngine().matchSuggestion(noteText, suggestion);
		expect(matched.status).toBe("unresolved");
		expect(matched.location.relocation?.targetResolved).toBe(true);
		expect(matched.location.relocation?.anchorResolved).toBe(false);
		expect(matched.location.relocation?.reason).toBe("Couldn't find the destination text in the manuscript.");
	});

	it("names the source when the text to move cannot be found", () => {
		const suggestion = buildMoveSuggestion(
			"A passage that does not exist anywhere in the manuscript.",
			"She recalls from her survivalist training that this is a mark of the Natural Services.",
		);
		const matched = new MatchEngine().matchSuggestion(noteText, suggestion);
		expect(matched.status).toBe("unresolved");
		expect(matched.location.relocation?.targetResolved).toBe(false);
		expect(matched.location.relocation?.reason).toBe("Couldn't find the text to move in the manuscript.");
	});
});
