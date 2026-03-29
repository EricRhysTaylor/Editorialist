import { REVIEW_BLOCK_FENCE } from "./ReviewBlockFormat";

export const REVIEW_TEMPLATE_BLOCK = [
	"```" + REVIEW_BLOCK_FENCE,
	"Reviewer: GPT-5.3",
	"ReviewerType: ai-editor",
	"Provider: OpenAI",
	"Model: GPT-5.3",
	"",
	"=== EDIT ===",
	"SceneId: scn_xxxxxxxx",
	"Original: ...",
	"Revised: ...",
	"Why: ...",
	"",
	"=== CUT ===",
	"SceneId: scn_xxxxxxxx",
	"Target: ...",
	"Why: ...",
	"",
	"=== CONDENSE ===",
	"SceneId: scn_xxxxxxxx",
	"Target: ...",
	"Suggestion: ...",
	"Why: ...",
	"",
	"=== MOVE ===",
	"SceneId: scn_xxxxxxxx",
	"Target: ...",
	"Before: ...",
	"Why: ...",
	"```",
].join("\n");

export function buildReviewTemplate(selectedText?: string): string {
	const parts = ["Return only this fenced block. No extra text.", "", REVIEW_TEMPLATE_BLOCK];

	if (selectedText?.trim()) {
		parts.push("", "Passage:", selectedText);
	}

	return parts.join("\n");
}
