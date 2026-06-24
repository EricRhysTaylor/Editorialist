import { REVIEW_BLOCK_FENCE } from "./ReviewBlockFormat";
import { AUTHOR_QUERY_PATTERN } from "./AuthorQueryMarker";
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
	"=== QUERY ===",
	"Id: Q1",
	"SceneId: scn_xxxxxxxx",
	"Question: <the author's %%ai: …%% question, repeated>",
	"Answer: <direct answer with a recommendation>",
	"Recommendation: <optional one-line takeaway>",
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
	"Target: \"<verbatim opening fragment>\" → \"<verbatim closing fragment>\"",
	"Suggestion: ...",
	"Why: ...",
	"",
	"=== EXPAND ===",
	"SceneId: scn_xxxxxxxx",
	"Target: ...",
	"Suggestion: Optional. Supply expanded prose for a direct, applicable expand; omit it for advisory \"develop this beat\" guidance.",
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
	"  Format A — REVIEW BLOCK (per-scene line edits, memos, cuts, condenses, expands, moves).",
	"             Use when the work is concrete prose-level changes targeting specific",
	"             scenes.",
	"",
	"  Format B — EDITORIALISM FILE (structural / multi-scene / doctrinal agenda).",
	"             Use when the work spans scene ranges, applies to the whole",
	"             manuscript, defines design intent, or organizes a checklist the",
	"             author needs to walk through across multiple sessions. Output the",
	"             markdown file in full inside a ```editorialism fenced block. When",
	"             the author pastes your reply into the launcher, Editorialist saves",
	`             it to \`Editorialist/<Book>/<Title>.md\` and opens the ${EDITORIALISM_TYPE_VALUE} panel.`,
	"",
	"Note on code fences: most chat UIs strip outer triple-backtick fences when the user",
	"copies your reply. Editorialist's importer accepts both fenced and unfenced output —",
	"what matters is the metadata header and the `=== SECTION ===` markers. Don't worry",
	"about preserving the fences; produce the content cleanly either way.",
	"",
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"FORMAT A — REVIEW BLOCK",
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
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
	"Author queries: the manuscript may contain hidden `%%ai: <question>%%` markers anywhere",
	"in the prose — questions the author embedded inline for you (they survive a Radial",
	"Timeline export with AI comments retained, so they can appear in the pasted manuscript,",
	"not just a selected passage). Answer EVERY one in its own === QUERY === block: repeat the",
	"Question, give a direct Answer with a recommendation (not an acknowledgement), and set",
	"SceneId to the scene the marker sits in. Do not treat the marker as prose to edit, and do",
	"not echo the `%%ai:%%` delimiters back in your output.",
	"",
	"Each operation entry (EDIT / CUT / CONDENSE / EXPAND / MOVE) targets a single scene via SceneId.",
	"Items in the same block may target different scenes — repeat the operation header and",
	"use the appropriate SceneId for each.",
	"",
	"CONDENSE Target format: write `Target: \"<opening>\" → \"<closing>\"` where both fragments",
	"are copied byte-for-byte from the manuscript (≤12 words each is plenty — they're anchors,",
	"not the whole passage). Editorialist locates the passage between them by exact text match;",
	"a paraphrased description routes the suggestion to \"Passage not located\" and the author",
	"cannot act on it. To condense multiple separate passages into one tighter beat, emit one",
	"CONDENSE per passage and put the combined replacement in `Suggestion:` on the entry where",
	"the new beat should land (use a brief Suggestion like \"merge with companion CONDENSE\" on",
	"the others, or repeat the same Suggestion text).",
	"",
	"EXPAND is the inverse of CONDENSE — use it to develop, slow down, or decompress a beat.",
	"Copy the `Target:` text byte-for-byte from the manuscript. Include a `Suggestion:` with the",
	"expanded prose only when you can supply finished wording (a direct, applicable expand);",
	"otherwise omit it and the entry stays advisory guidance the author develops by hand.",
	"",
	"SceneIds: every entry's SceneId MUST be a real value drawn from the manuscript or the",
	"\"Scene IDs in this context\" list provided below. Do NOT invent IDs.",
	"",
	"When the scene id is NOT visible: if the prose you are reviewing was pasted without a",
	"scene id, and no id in the \"Scene IDs in this context\" list demonstrably belongs to",
	"that exact text, do NOT guess and do NOT reuse a scene id that appeared earlier in this",
	"conversation for different prose — a stale or guessed id routes the entire batch to the",
	"wrong scene silently. Instead, OMIT the SceneId field entirely on those entries.",
	"Editorialist will route them to the scene the author is currently viewing and flag them",
	"for manual verification, which is recoverable; a confidently wrong id is not. Add a",
	"=== MEMO === (no SceneId) stating that the target scene could not be identified from",
	"the provided text so the author can confirm placement before applying the edits.",
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
	"- [ ] Subplot-level work [scope:: subplot:Shail IT subplot]",
].join("\n");

const EDITORIALISM_TEMPLATE_GUIDANCE = [
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"FORMAT B — EDITORIALISM FILE",
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"",
	"Wrap the entire markdown file (frontmatter included) in a ```editorialism fenced",
	"block. The author pastes the reply into the launcher and Editorialist writes it to",
	"`Editorialist/<Book>/<Title>.md` (deriving the path from `book:` and `title:`),",
	"creating the folder and opening the panel. Re-emitting the same `title:` overwrites",
	"the prior version in place, so an updated agenda supersedes cleanly. If the chat",
	"strips the fence on copy, the `type: editorialism` frontmatter still lets Editorialist",
	"find the file — but keep the fence so trailing commentary is never swept in.",
	"",
	"Required:",
	`- Frontmatter \`type: ${EDITORIALISM_TYPE_VALUE}\` — files without this are ignored.`,
	"- `book:` must match the active book label exactly (it sets the destination folder).",
	"- `title:` becomes the file name; keep it stable to update the same file across sessions.",
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
	"    `subplot:<name>`     — named subplot spanning multiple scenes",
	"- `[tags:: tag1, tag2]` (optional) — comma- or space-separated.",
	"- `[scenes:: <n>]` / `[words:: <n>]` (optional) — when a directive implies NEW",
	"    prose, declare how many new scenes or roughly how many words. Editorialist's",
	"    revision-effort estimate uses these directly instead of guessing from the text.",
	"- `[effort:: light|medium|heavy]` (optional) — relative weight for a non-drafting",
	"    directive (restructure / doctrine) where scene/word counts don't apply.",
	"",
	"Status markers (the character inside the brackets):",
	"  `[ ]` open    `[/]` in progress    `[x]` done    `[-]` deferred    `[?]` question",
	"",
	"Write items as concrete directives, not paraphrased commentary. Every item should",
	"be something the author can mark done. Group related directives under the same",
	"section heading. Default new items to `[ ]` open.",
];

export interface ReviewTemplateContext {
	bookLabel?: string | null;
	activeSceneId?: string | null;
	sceneIds?: ReadonlyArray<{ id: string; title: string }>;
}

function buildSceneIdContextSection(context: ReviewTemplateContext): string | null {
	const hasAnyContext = Boolean(
		context.bookLabel || context.activeSceneId || (context.sceneIds && context.sceneIds.length > 0),
	);
	if (!hasAnyContext) {
		return null;
	}
	const lines: string[] = [
		"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
		"SCENE IDS — USE THESE EXACT VALUES",
		"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
		"",
	];
	if (context.bookLabel) {
		lines.push(`Active book: ${context.bookLabel}`);
	}
	if (context.activeSceneId) {
		lines.push(`Active scene id: ${context.activeSceneId}`);
	}
	if (context.sceneIds && context.sceneIds.length > 0) {
		lines.push("", `Available scenes in this book (${context.sceneIds.length}):`);
		for (const entry of context.sceneIds) {
			lines.push(`- ${entry.id} — ${entry.title}`);
		}
	}
	lines.push(
		"",
		"Every SceneId in your output must match one of the values above exactly.",
		"If your input includes a Radial Timeline manuscript export, scene ids appear",
		"inline in that export — those match the list here. Never use the placeholder",
		"`scn_xxxxxxxx`; never invent ids.",
	);
	return lines.join("\n");
}

const SECTION_BAR = "━".repeat(75);

interface ExtractedAuthorQueries {
	cleanedText: string;
	questions: string[];
}

// Pull every `%%ai: …%%` out of the passage and return the prose with the
// markers removed. The vault note is never touched — this operates only on the
// copy sent to the model, so the author's source keeps its comments.
function extractAuthorQueries(passage: string): ExtractedAuthorQueries {
	const questions: string[] = [];
	const cleanedText = passage.replace(AUTHOR_QUERY_PATTERN, (_match, body: string) => {
		const question = body.replace(/\s+/g, " ").trim();
		if (question) {
			questions.push(question);
		}
		return "";
	});
	return { cleanedText, questions };
}

// The query answer contract. SceneId is embedded in both the prompt and the
// required output so routing is self-describing across the copy-out/paste-back
// gap — there is no temporary map to carry the question→scene link.
function buildAuthorQueriesSection(questions: string[], activeSceneId?: string | null): string {
	const sceneId = activeSceneId?.trim();
	const lines: string[] = [
		SECTION_BAR,
		"AUTHOR QUERIES — answer each directly; do not treat as prose.",
		SECTION_BAR,
		"",
		"The author embedded these questions inline in the passage below. They have",
		"been removed from the prose so you do not edit them. Answer every one in its",
		`own === QUERY === block, echoing its Id${sceneId ? " and SceneId" : ""} so Editorialist can route the`,
		"answer back to the right scene. Give a direct recommendation, not an",
		"acknowledgement:",
		"",
		"=== QUERY ===",
		"Id: Q1",
	];
	if (sceneId) {
		lines.push(`SceneId: ${sceneId}`);
	}
	lines.push(
		"Question: <repeat the question being answered>",
		"Answer: <direct answer with a recommendation>",
		"Recommendation: <optional one-line takeaway>",
		"",
		"Queries:",
	);
	questions.forEach((question, index) => {
		const id = `Q${index + 1}`;
		lines.push(sceneId ? `[${id}] SceneId: ${sceneId} — ${question}` : `[${id}] ${question}`);
	});
	return lines.join("\n");
}

export function buildReviewTemplate(
	selectedText?: string,
	context?: ReviewTemplateContext,
): string {
	const parts = [
		REVIEW_TEMPLATE_GUIDANCE.join("\n"),
		"",
		REVIEW_TEMPLATE_BLOCK,
		"",
		EDITORIALISM_TEMPLATE_GUIDANCE.join("\n"),
		"",
		EDITORIALISM_FILE_TEMPLATE,
	];

	const sceneIdSection = context ? buildSceneIdContextSection(context) : null;
	if (sceneIdSection) {
		parts.push("", sceneIdSection);
	}

	if (selectedText?.trim()) {
		const { cleanedText, questions } = extractAuthorQueries(selectedText);
		if (questions.length > 0) {
			parts.push("", buildAuthorQueriesSection(questions, context?.activeSceneId));
		}
		parts.push("", "Passage:", cleanedText);
	}

	return parts.join("\n");
}
