import { describe, expect, it } from "vitest";
import { extractReviewBlocks, findImportedReviewBlocks } from "./ReviewBlockFormat";

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
