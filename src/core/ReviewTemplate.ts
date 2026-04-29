import { REVIEW_BLOCK_FENCE } from "./ReviewBlockFormat";
import { EDITORIALISM_TYPE_VALUE } from "../services/EditorialismService";
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
	"=== MEMO ===",
	"SceneId: scn_xxxxxxxx",
	"Issues: Optional scene-scoped memo. Add a SceneId to attach this memo to a single scene; omit it to attach the memo to every scene that received edits.",
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
	"Editorialist accepts two output formats. Choose the one that fits the work, or",
	"produce both in the same response when the manuscript needs line-level edits AND",
	"structural directives:",
	"",
	"  Format A — REVIEW BLOCK (per-scene line edits, memos, cuts, condenses, moves).",
	"             Use when the work is concrete prose-level changes targeting specific",
	"             scenes. Output the fenced block exactly as shown below.",
	"",
	"  Format B — EDITORIALISM FILE (structural / multi-scene / doctrinal agenda).",
	"             Use when the work spans scene ranges, applies to the whole",
	"             manuscript, defines design intent, or organizes a checklist the",
	"             author needs to walk through across multiple sessions. Output the",
	"             markdown file exactly as shown below — the author saves it to",
	`             \`Editorialist/<Book>/<Title>.md\` and the ${EDITORIALISM_TYPE_VALUE} panel picks it up.`,
	"",
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"FORMAT A — REVIEW BLOCK",
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"",
	"Return only the fenced block — no surrounding prose.",
	"",
	"Use === MEMO === sections for editorial commentary that doesn't belong inline as a line",
	"edit. Use as many MEMO blocks as you need — they can be freeform prose, or use the",
	"optional Strengths: / Issues: fields. There is no fixed structure.",
	"",
	"Each MEMO may optionally include a SceneId to scope it to a single scene. A MEMO with",
	"no SceneId is duplicated to every scene that received edits in this batch, so the",
	"editorial framing appears above the line edits in each scene. Mix freely: one wide",
	"MEMO at the top for manuscript-level patterns, then additional scoped MEMOs for",
	"scene-specific notes.",
	"",
	"Each operation entry (EDIT / CUT / CONDENSE / MOVE) targets a single scene via SceneId.",
	"Items in the same block may target different scenes — repeat the operation header and",
	"use the appropriate SceneId for each.",
];

export const EDITORIALISM_FILE_TEMPLATE = [
	"---",
	`type: ${EDITORIALISM_TYPE_VALUE}`,
	"title: <Short, descriptive title>",
	"book: <Active book name — must match the book label exactly>",
	"status: in-progress",
	`created: ${new Date().toISOString().slice(0, 10)}`,
	"---",
	"",
	"# <Same as title>",
	"",
	"## <Theme or pillar — one section per major concern>",
	"- [ ] Specific actionable directive [scope:: <scope>] [tags:: <tag1>, <tag2>]",
	"- [ ] Another directive in the same theme [scope:: <scope>]",
	"",
	"## <Another section>",
	"- [ ] Single-scene directive [scope:: 22]",
	"- [ ] Scene-range directive [scope:: 13–22]",
	"- [ ] Manuscript-wide design directive [scope:: manuscript]",
	"- [ ] Arc-level work [scope:: arc:Shail IT subplot]",
].join("\n");

const EDITORIALISM_TEMPLATE_GUIDANCE = [
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"FORMAT B — EDITORIALISM FILE",
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"",
	"Output the entire markdown file including frontmatter. The author saves it as a",
	"new file under `Editorialist/<Book>/<Title>.md`.",
	"",
	"Required:",
	`- Frontmatter \`type: ${EDITORIALISM_TYPE_VALUE}\` — files without this are ignored.`,
	"- `book:` must match the active book label exactly.",
	"",
	"Structure:",
	"- Use `## ` headings to group items into themed sections (one heading per pillar / concern).",
	"- Each item is a GFM task line: `- [ ] Item text` followed by inline metadata.",
	"",
	"Inline metadata:",
	"- `[scope:: <value>]` (recommended) — accepts:",
	"    `manuscript`         — applies to the whole book",
	"    `<scene-num>`        — single scene (e.g. `22`)",
	"    `<start>–<end>`      — scene range (en-dash or hyphen, e.g. `13–22` or `13-22`)",
	"    `arc:<name>`         — named arc spanning multiple scenes",
	"- `[tags:: tag1, tag2]` (optional) — comma- or space-separated.",
	"",
	"Status markers (the character inside the brackets):",
	"  `[ ]` open    `[/]` in progress    `[x]` done    `[-]` deferred    `[?]` question",
	"",
	"Write items as concrete directives, not paraphrased commentary. Every item should",
	"be something the author can mark done. Group related directives under the same",
	"section heading. Default new items to `[ ]` open.",
];

export function buildReviewTemplate(selectedText?: string): string {
	const parts = [
		REVIEW_TEMPLATE_GUIDANCE.join("\n"),
		"",
		REVIEW_TEMPLATE_BLOCK,
		"",
		EDITORIALISM_TEMPLATE_GUIDANCE.join("\n"),
		"",
		EDITORIALISM_FILE_TEMPLATE,
	];

	if (selectedText?.trim()) {
		parts.push("", "Passage:", selectedText);
	}

	return parts.join("\n");
}
