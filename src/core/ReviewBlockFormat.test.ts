import { describe, expect, it } from "vitest";
import {
	classifyNoteReviewBlocks,
	extractReviewBlocks,
	findImportedReviewBlocks,
	findUnimportedReviewBlock,
} from "./ReviewBlockFormat";

// A raw review block as an AI would write it straight into a note: real metadata
// and sections, but no BatchId / ImportedBy stamp (Editorialist adds those only
// on import).
function rawBlock(sceneId = "scn_x", original = "a"): string {
	return [
		"```editorialist-review",
		"Template: Editorialist advanced",
		"Reviewer: GPT-5.4",
		"",
		"=== EDIT ===",
		`SceneId: ${sceneId}`,
		`Original: ${original}`,
		"Revised: b",
		"```",
	].join("\n");
}

// A realistic imported block as ImportEngine serializes it: BatchId, ImportedBy,
// ImportedAt, then reviewer metadata and a section.
function importedNote(extraHeader = ""): string {
	return [
		"Some scene prose before the block.",
		"",
		"```editorialist-review",
		"BatchId: batch-abc123",
		"ImportedBy: Editorialist",
		"ImportedAt: 2026-06-23T00:23:29Z",
		extraHeader,
		"Reviewer: Claude Opus 4.8",
		"ReviewerType: ai-editor",
		"Provider: Anthropic",
		"Model: Claude Opus 4.8",
		"",
		"=== EDIT ===",
		"SceneId: scn_x",
		"Original: a",
		"Revised: b",
		"```",
	]
		.filter((line) => line !== "")
		.join("\n");
}

describe("ReviewBlockFormat — imported block detection", () => {
	it("detects a fenced imported block whose header carries ImportedAt", () => {
		// Regression: ImportedAt is not a 'known' metadata key, and the raw-block
		// scanner used to break on the first unknown leading field — truncating the
		// header so BatchId/ImportedBy were lost and the block read as non-imported,
		// orphaning it from cleanup. It must parse as a fenced block with the batch.
		const note = importedNote();
		const extracted = extractReviewBlocks(note);
		expect(extracted).toHaveLength(1);
		expect(extracted[0].source).toBe("fenced");

		const imported = findImportedReviewBlocks(note);
		expect(imported).toHaveLength(1);
		expect(imported[0].batchId).toBe("batch-abc123");
		expect(imported[0].importedBy).toBe("Editorialist");
	});

	it("tolerates an unknown leading header key without dropping the block", () => {
		const note = importedNote("CustomFutureKey: whatever");
		const imported = findImportedReviewBlocks(note);
		expect(imported).toHaveLength(1);
		expect(imported[0].batchId).toBe("batch-abc123");
	});

	it("filters out a fenced block not stamped by Editorialist", () => {
		const note = [
			"```editorialist-review",
			"BatchId: batch-xyz",
			"ImportedBy: SomeoneElse",
			"=== EDIT ===",
			"Original: a",
			"Revised: b",
			"```",
		].join("\n");
		expect(findImportedReviewBlocks(note)).toHaveLength(0);
	});
});

describe("ReviewBlockFormat — note classification", () => {
	it("classifies a note with no review block as 'none'", () => {
		expect(classifyNoteReviewBlocks("Just some scene prose.")).toBe("none");
		expect(findUnimportedReviewBlock("Just some scene prose.")).toBeNull();
	});

	it("classifies a raw AI-written block as 'unimported' and locates it", () => {
		const note = `Scene prose.\n\n${rawBlock()}`;
		expect(classifyNoteReviewBlocks(note)).toBe("unimported");
		const found = findUnimportedReviewBlock(note);
		expect(found).not.toBeNull();
		expect(note.slice(found!.startOffset, found!.endOffset)).toContain("=== EDIT ===");
	});

	it("classifies a stamped imported block as 'registered' and finds no raw block", () => {
		const note = importedNote();
		expect(classifyNoteReviewBlocks(note)).toBe("registered");
		expect(findUnimportedReviewBlock(note)).toBeNull();
	});

	it("treats a BatchId without ImportedBy as 'ambiguous' (suspicious half-stamp)", () => {
		const note = [
			"```editorialist-review",
			"BatchId: batch-orphan",
			"=== EDIT ===",
			"SceneId: scn_x",
			"Original: a",
			"Revised: b",
			"```",
		].join("\n");
		expect(classifyNoteReviewBlocks(note)).toBe("ambiguous");
		expect(findUnimportedReviewBlock(note)).toBeNull();
	});

	it("treats two raw blocks as 'ambiguous' — cannot pick which to formalize", () => {
		const note = `${rawBlock("scn_a", "first")}\n\n${rawBlock("scn_b", "second")}`;
		expect(extractReviewBlocks(note)).toHaveLength(2);
		expect(classifyNoteReviewBlocks(note)).toBe("ambiguous");
		expect(findUnimportedReviewBlock(note)).toBeNull();
	});

	it("still surfaces the lone raw block when a registered block also exists", () => {
		const note = `${importedNote()}\n\n${rawBlock()}`;
		expect(classifyNoteReviewBlocks(note)).toBe("unimported");
		const found = findUnimportedReviewBlock(note);
		expect(found).not.toBeNull();
		// The located block must be the raw one, not the stamped/registered one.
		expect(note.slice(found!.startOffset, found!.endOffset)).not.toContain("ImportedBy: Editorialist");
	});
});
