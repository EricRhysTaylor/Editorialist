import { REVIEW_BLOCK_FENCE } from "./ReviewBlockFormat";

const OPERATION_KEYWORDS = ["EDIT", "MOVE", "CUT", "CONDENSE", "MEMO"] as const;
type OperationKeyword = (typeof OPERATION_KEYWORDS)[number];

const METADATA_KEYS = new Set([
	"batchid",
	"importedby",
	"template",
	"templateyear",
	"supportedoperations",
	"sceneidsource",
	"reviewer",
	"reviewertype",
	"provider",
	"model",
]);

const METADATA_KEY_LINE = /^([A-Za-z][A-Za-z]*)\s*:/;

const DECORATED_SECTION_VARIANTS: RegExp[] = [
	/^\s*={2,}\s*(EDIT|MOVE|CUT|CONDENSE|MEMO)\s*={2,}\s*$/i,
	/^\s*-{2,}\s*(EDIT|MOVE|CUT|CONDENSE|MEMO)\s*-{2,}\s*$/i,
	/^\s*#{1,6}\s+(EDIT|MOVE|CUT|CONDENSE|MEMO)\s*#*\s*$/i,
	/^\s*\*{1,3}\s*(EDIT|MOVE|CUT|CONDENSE|MEMO)\s*\*{1,3}\s*$/i,
	/^\s*\[\s*(EDIT|MOVE|CUT|CONDENSE|MEMO)\s*\]\s*$/i,
];

interface StructuredOperation {
	type?: unknown;
	sceneId?: unknown;
	note?: unknown;
	path?: unknown;
	scene?: unknown;
	original?: unknown;
	revised?: unknown;
	target?: unknown;
	suggestion?: unknown;
	before?: unknown;
	after?: unknown;
	why?: unknown;
	strengths?: unknown;
	issues?: unknown;
	body?: unknown;
}

interface StructuredDocument {
	template?: unknown;
	templateYear?: unknown;
	supportedOperations?: unknown;
	sceneIdSource?: unknown;
	reviewer?: unknown;
	reviewerType?: unknown;
	provider?: unknown;
	model?: unknown;
	operations?: unknown;
}

export function normalizeReviewPaste(rawText: string): string {
	if (!rawText || !rawText.trim()) {
		return rawText ?? "";
	}

	const fromStructured = tryNormalizeFromJson(rawText);
	if (fromStructured) {
		return fromStructured;
	}

	let working = rawText.replace(/\r\n?/g, "\n");
	working = stripChatPrelude(working);
	working = unwrapOuterFenceLeniently(working);
	working = canonicalizeSectionDelimiters(working);

	return working;
}

function stripChatPrelude(text: string): string {
	const lines = text.split("\n");
	let firstSignal = -1;
	for (let index = 0; index < lines.length; index += 1) {
		const trimmed = (lines[index] ?? "").trim();
		if (!trimmed) {
			continue;
		}

		if (trimmed.startsWith("```")) {
			firstSignal = index;
			break;
		}

		if (matchDecoratedSectionVariant(trimmed)) {
			firstSignal = index;
			break;
		}

		const keyMatch = trimmed.match(METADATA_KEY_LINE);
		if (keyMatch && keyMatch[1] && METADATA_KEYS.has(keyMatch[1].toLowerCase())) {
			firstSignal = index;
			break;
		}
	}

	if (firstSignal <= 0) {
		return text;
	}

	return lines.slice(firstSignal).join("\n");
}

function unwrapOuterFenceLeniently(text: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith("```")) {
		return text;
	}

	const firstNewline = trimmed.indexOf("\n");
	if (firstNewline === -1) {
		return text;
	}

	const firstFenceLine = trimmed.slice(0, firstNewline).trim();
	if (firstFenceLine.includes(REVIEW_BLOCK_FENCE)) {
		return trimmed;
	}

	const remainder = trimmed.slice(firstNewline + 1);
	const closingFenceIndex = findClosingFenceIndex(remainder);
	if (closingFenceIndex === -1) {
		return remainder;
	}

	return remainder.slice(0, closingFenceIndex).trimEnd();
}

function findClosingFenceIndex(text: string): number {
	const lines = text.split("\n");
	let offset = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (/^\s*```\s*$/.test(line)) {
			return offset;
		}
		offset += line.length + 1;
	}
	return -1;
}

function matchDecoratedSectionVariant(line: string): OperationKeyword | null {
	for (const pattern of DECORATED_SECTION_VARIANTS) {
		const match = line.match(pattern);
		const keyword = match?.[1]?.toUpperCase();
		if (keyword && (OPERATION_KEYWORDS as readonly string[]).includes(keyword)) {
			return keyword as OperationKeyword;
		}
	}
	return null;
}

function canonicalizeSectionDelimiters(text: string): string {
	return text
		.split("\n")
		.map((line) => {
			const op = matchDecoratedSectionVariant(line);
			return op ? `=== ${op} ===` : line;
		})
		.join("\n");
}

function tryNormalizeFromJson(rawText: string): string | null {
	const trimmed = rawText.trim();
	const unfenced = trimmed
		.replace(/^```(?:json|yaml|yml)?\s*\n?/i, "")
		.replace(/\n?```\s*$/, "")
		.trim();
	if (!unfenced) {
		return null;
	}

	const firstChar = unfenced[0];
	if (firstChar !== "{" && firstChar !== "[") {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(unfenced);
	} catch {
		return null;
	}

	const document = coerceStructuredDocument(parsed);
	if (!document) {
		return null;
	}

	const operations = Array.isArray(document.operations) ? document.operations : [];
	if (operations.length === 0) {
		return null;
	}

	return serializeStructuredDocument(document, operations);
}

function coerceStructuredDocument(value: unknown): StructuredDocument | null {
	if (Array.isArray(value)) {
		return { operations: value };
	}
	if (!value || typeof value !== "object") {
		return null;
	}
	const obj = value as StructuredDocument;
	if (!Array.isArray(obj.operations)) {
		return null;
	}
	return obj;
}

function serializeStructuredDocument(document: StructuredDocument, operations: unknown[]): string {
	const lines: string[] = ["```" + REVIEW_BLOCK_FENCE];
	pushString(lines, "Template", document.template);
	pushString(lines, "TemplateYear", document.templateYear);
	pushSupportedOperations(lines, document.supportedOperations);
	pushString(lines, "SceneIdSource", document.sceneIdSource);
	pushString(lines, "Reviewer", document.reviewer);
	pushString(lines, "ReviewerType", document.reviewerType);
	pushString(lines, "Provider", document.provider);
	pushString(lines, "Model", document.model);

	let appendedAny = false;
	for (const rawOp of operations) {
		if (!rawOp || typeof rawOp !== "object") {
			continue;
		}
		const op = rawOp as StructuredOperation;
		const type = String(op.type ?? "").toUpperCase();
		if (!(OPERATION_KEYWORDS as readonly string[]).includes(type)) {
			continue;
		}

		appendedAny = true;
		lines.push("");
		lines.push(`=== ${type} ===`);
		pushString(lines, "SceneId", op.sceneId);
		pushString(lines, "Note", op.note);
		pushString(lines, "Path", op.path);
		pushString(lines, "Scene", op.scene);
		pushString(lines, "Original", op.original);
		pushString(lines, "Revised", op.revised);
		pushString(lines, "Target", op.target);
		pushString(lines, "Suggestion", op.suggestion);
		pushString(lines, "Before", op.before);
		pushString(lines, "After", op.after);
		pushString(lines, "Strengths", op.strengths);
		pushString(lines, "Issues", op.issues);
		pushString(lines, "Body", op.body);
		pushString(lines, "Why", op.why);
	}

	if (!appendedAny) {
		return "";
	}

	lines.push("```");
	return lines.join("\n");
}

function pushString(lines: string[], key: string, value: unknown): void {
	if (value === undefined || value === null) {
		return;
	}
	const str = typeof value === "string" ? value : String(value);
	const trimmed = str.trim();
	if (!trimmed) {
		return;
	}
	lines.push(`${key}: ${trimmed}`);
}

function pushSupportedOperations(lines: string[], value: unknown): void {
	if (Array.isArray(value)) {
		const joined = value
			.map((entry) => (typeof entry === "string" ? entry.trim() : String(entry).trim()))
			.filter((entry) => entry.length > 0)
			.join(", ");
		if (joined) {
			lines.push(`SupportedOperations: ${joined}`);
		}
		return;
	}
	pushString(lines, "SupportedOperations", value);
}
