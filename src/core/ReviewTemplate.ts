import { REVIEW_BLOCK_FENCE } from "./ReviewBlockFormat";
import {
	SUPPORTED_REVIEW_OPERATION_LABELS,
	SUPPORTED_REVIEW_OPERATIONS,
} from "../models/ReviewSuggestion";

const ADVANCED_REVIEW_TEMPLATE_MODEL = "GPT-5.4";

export const ADVANCED_REVIEW_TEMPLATE_YEAR = new Date().getFullYear();
export const ADVANCED_REVIEW_TEMPLATE_TITLE = `Advanced template (${ADVANCED_REVIEW_TEMPLATE_YEAR})`;
export const SUPPORTED_REVIEW_OPERATION_SUMMARY = SUPPORTED_REVIEW_OPERATIONS
	.map((operation) => SUPPORTED_REVIEW_OPERATION_LABELS[operation])
	.join(", ");

export const REVIEW_TEMPLATE_BLOCK = [
	"```" + REVIEW_BLOCK_FENCE,
	"Template: Editorialist advanced",
	`TemplateYear: ${ADVANCED_REVIEW_TEMPLATE_YEAR}`,
	`SupportedOperations: ${SUPPORTED_REVIEW_OPERATION_SUMMARY}`,
	`Reviewer: ${ADVANCED_REVIEW_TEMPLATE_MODEL}`,
	"ReviewerType: ai-editor",
	"Provider: OpenAI",
	`Model: ${ADVANCED_REVIEW_TEMPLATE_MODEL}`,
	"",
	"=== MEMO ===",
	"Strengths:",
	"What is working across the scenes you reviewed.",
	"",
	"Issues:",
	"Patterns or risks to surface before the author works through the line edits.",
	"",
	"=== EDIT ===",
	"SceneId: scn_first_scene_id",
	"Original: ...",
	"Revised: ...",
	"Why: ...",
	"",
	"=== EDIT ===",
	"SceneId: scn_second_scene_id",
	"Original: ...",
	"Revised: ...",
	"Why: Items can target a different scene — use the matching SceneId per entry.",
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

const REVIEW_TEMPLATE_GUIDANCE = [
	"Return only this fenced block. No extra text.",
	"",
	"Use one MEMO section at the top for general commentary on the scenes you reviewed —",
	"strengths, recurring issues, and patterns the author should consider before working",
	"through the individual line edits. Strengths and Issues are optional fields; freeform",
	"prose under the header is also accepted.",
	"",
	"Each operation entry (EDIT / CUT / CONDENSE / MOVE) targets a single scene via SceneId.",
	"Items in the same block may target different scenes — repeat the operation header and",
	"use the appropriate SceneId for each.",
];

export function buildReviewTemplate(selectedText?: string): string {
	const parts = [REVIEW_TEMPLATE_GUIDANCE.join("\n"), "", REVIEW_TEMPLATE_BLOCK];

	if (selectedText?.trim()) {
		parts.push("", "Passage:", selectedText);
	}

	return parts.join("\n");
}
