import { normalizeMatchText } from "./TextMatching";

export interface AnchorRewrite {
	original: string;
	revised: string;
	reason: string;
}

const ANCHOR_MARKER = /^\s*\([^)]+\)\s*$/;
const REVISED_DIRECTIVE = /^\s*\(([^)]+)\)\s*([\s\S]*)$/;
const INSERT_AFTER = /^insert\s+after\s+(.+)$/i;
const INSERT_BEFORE = /^insert\s+before\s+(.+)$/i;

export function isAnchorMarker(original: string): boolean {
	return ANCHOR_MARKER.test(original);
}

export function rewriteAnchorEdit(
	noteText: string,
	original: string,
	revised: string,
): AnchorRewrite | null {
	if (!isAnchorMarker(original)) {
		return null;
	}

	const directiveMatch = revised.match(REVISED_DIRECTIVE);
	if (!directiveMatch) {
		return null;
	}

	const directive = (directiveMatch[1] ?? "").trim().toLowerCase();
	const body = (directiveMatch[2] ?? "").trim();
	if (!body) {
		return null;
	}

	const paragraphs = splitParagraphs(noteText);
	if (paragraphs.length === 0) {
		return null;
	}

	if (directive === "append") {
		const anchor = paragraphs[paragraphs.length - 1];
		if (!anchor) {
			return null;
		}
		return {
			original: anchor,
			revised: `${anchor}\n\n${body}`,
			reason: "Anchored via (append) directive at scene end.",
		};
	}

	if (directive === "prepend") {
		const anchor = paragraphs[0];
		if (!anchor) {
			return null;
		}
		return {
			original: anchor,
			revised: `${body}\n\n${anchor}`,
			reason: "Anchored via (prepend) directive at scene start.",
		};
	}

	const insertAfter = directive.match(INSERT_AFTER);
	if (insertAfter && insertAfter[1]) {
		const keyword = insertAfter[1].trim();
		const anchor = findParagraphMatching(paragraphs, keyword);
		if (!anchor) {
			return null;
		}
		return {
			original: anchor,
			revised: `${anchor}\n\n${body}`,
			reason: `Anchored via (insert after) directive: "${keyword}".`,
		};
	}

	const insertBefore = directive.match(INSERT_BEFORE);
	if (insertBefore && insertBefore[1]) {
		const keyword = insertBefore[1].trim();
		const anchor = findParagraphMatching(paragraphs, keyword);
		if (!anchor) {
			return null;
		}
		return {
			original: anchor,
			revised: `${body}\n\n${anchor}`,
			reason: `Anchored via (insert before) directive: "${keyword}".`,
		};
	}

	return null;
}

function splitParagraphs(noteText: string): string[] {
	return noteText
		.split(/\n\s*\n/)
		.map((p) => p.replace(/\s+$/, ""))
		.filter((p) => p.trim().length > 0);
}

function findParagraphMatching(paragraphs: string[], keyword: string): string | null {
	const normalizedKeyword = normalizeMatchText(keyword).toLowerCase();
	if (!normalizedKeyword) {
		return null;
	}

	for (const paragraph of paragraphs) {
		if (normalizeMatchText(paragraph).toLowerCase().includes(normalizedKeyword)) {
			return paragraph;
		}
	}

	const tokens = normalizedKeyword
		.split(/\s+/)
		.filter((token) => token.length >= 4);
	if (tokens.length === 0) {
		return null;
	}

	for (const paragraph of paragraphs) {
		const lower = normalizeMatchText(paragraph).toLowerCase();
		if (tokens.every((token) => lower.includes(token))) {
			return paragraph;
		}
	}

	return null;
}
