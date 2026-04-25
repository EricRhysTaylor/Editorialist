import { describe, expect, it } from "vitest";
import { normalizeReviewPaste } from "./PasteNormalizer";

describe("normalizeReviewPaste", () => {
	it("rewrites markdown-heading delimiters to canonical form", () => {
		const input = [
			"Template: Editorialist advanced",
			"Reviewer: GPT-5.4",
			"",
			"## EDIT",
			"SceneId: scn_a",
			"Original: foo",
			"Revised: bar",
			"",
			"### CUT ###",
			"SceneId: scn_b",
			"Target: baz",
		].join("\n");

		const out = normalizeReviewPaste(input);
		expect(out).toContain("=== EDIT ===");
		expect(out).toContain("=== CUT ===");
	});

	it("rewrites bold and bracket variants", () => {
		const input = ["**EDIT**", "SceneId: x", "[CONDENSE]", "Target: y"].join("\n");
		const out = normalizeReviewPaste(input);
		expect(out).toContain("=== EDIT ===");
		expect(out).toContain("=== CONDENSE ===");
	});

	it("strips ChatGPT prelude prose before metadata", () => {
		const input = [
			"Sure! Here are the suggested edits for your scene:",
			"",
			"Template: Editorialist advanced",
			"=== EDIT ===",
			"SceneId: scn_a",
			"Original: foo",
			"Revised: bar",
		].join("\n");

		const out = normalizeReviewPaste(input);
		expect(out.startsWith("Template: Editorialist advanced")).toBe(true);
	});

	it("unwraps an outer plain code fence with trailing chat prose", () => {
		const input = [
			"Here you go:",
			"",
			"```",
			"Template: Editorialist advanced",
			"=== EDIT ===",
			"SceneId: scn_a",
			"Original: foo",
			"Revised: bar",
			"```",
			"",
			"Let me know if you want changes!",
		].join("\n");

		const out = normalizeReviewPaste(input);
		expect(out).toContain("Template: Editorialist advanced");
		expect(out).toContain("=== EDIT ===");
		expect(out).not.toContain("Let me know");
		expect(out).not.toContain("```");
	});

	it("converts JSON payload to canonical fenced block", () => {
		const input = JSON.stringify({
			template: "Editorialist advanced",
			templateYear: 2026,
			supportedOperations: ["Edit", "Cut"],
			reviewer: "GPT-5.4",
			reviewerType: "ai-editor",
			provider: "OpenAI",
			model: "GPT-5.4",
			operations: [
				{
					type: "edit",
					sceneId: "scn_a",
					original: "foo",
					revised: "bar",
					why: "fix typo",
				},
				{
					type: "move",
					sceneId: "scn_b",
					target: "para",
					before: "anchor",
				},
			],
		});

		const out = normalizeReviewPaste(input);
		expect(out).toMatch(/^```editorialist-review/);
		expect(out).toContain("Template: Editorialist advanced");
		expect(out).toContain("SupportedOperations: Edit, Cut");
		expect(out).toContain("=== EDIT ===");
		expect(out).toContain("=== MOVE ===");
		expect(out).toContain("Original: foo");
		expect(out).toContain("Before: anchor");
	});

	it("converts JSON wrapped in ```json fences", () => {
		const input = [
			"```json",
			JSON.stringify({
				operations: [
					{ type: "cut", sceneId: "scn_a", target: "passage", why: "trim" },
				],
			}),
			"```",
		].join("\n");

		const out = normalizeReviewPaste(input);
		expect(out).toContain("=== CUT ===");
		expect(out).toContain("Target: passage");
	});

	it("leaves canonical input untouched", () => {
		const canonical = [
			"```editorialist-review",
			"Template: Editorialist advanced",
			"=== EDIT ===",
			"SceneId: scn_a",
			"Original: foo",
			"Revised: bar",
			"```",
		].join("\n");

		const out = normalizeReviewPaste(canonical);
		expect(out).toContain("```editorialist-review");
		expect(out).toContain("=== EDIT ===");
	});

	it("does not rewrite a heading that contains other words", () => {
		const input = ["## Editing notes", "Original: foo"].join("\n");
		const out = normalizeReviewPaste(input);
		expect(out).toContain("## Editing notes");
		expect(out).not.toContain("=== EDIT ===");
	});
});
