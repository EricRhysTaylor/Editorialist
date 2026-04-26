import type { App, TFile } from "obsidian";
import type {
	PendingEditSegment,
	PendingEditsSceneItem,
} from "../models/PendingEditSegment";

export const PENDING_EDITS_FRONTMATTER_KEY = "Pending Edits";

const INQUIRY_LINE_TOKEN = "[[Inquiry Brief —";

export function isInquiryLine(line: string): boolean {
	return line.includes(INQUIRY_LINE_TOKEN);
}

export interface PendingEditDisplay {
	mutedPrefix?: string;
	actionText: string;
}

/**
 * Extract the wiki-link target (note name) from an Inquiry-line segment.
 * Returns the bare note name (e.g. `Inquiry Brief — Pay4: Premature Resolution Apr 15 2026 @ 3.36pm`)
 * or null when the segment is not an Inquiry line or the link is malformed.
 */
export function extractInquiryBriefLinkTarget(segment: PendingEditSegment): string | null {
	if (segment.kind !== "inquiry") {
		return null;
	}
	const match = segment.text.match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
	if (!match) {
		return null;
	}
	const target = match[1]?.trim();
	return target && target.length > 0 ? target : null;
}

/**
 * Split an Inquiry-line segment for display so the wiki-link prefix renders muted
 * and the author's eye locks onto the actual revision action.
 *
 * Inquiry format: `[[Inquiry Brief — <title>|Briefing]] — <action text>`
 *   → mutedPrefix: `[[Inquiry Brief — <title>|Briefing]] — `
 *   → actionText:  `<action text>`
 *
 * Human segments keep the full text as actionText with no prefix.
 */
export function formatPendingEditForDisplay(segment: PendingEditSegment): PendingEditDisplay {
	if (segment.kind !== "inquiry") {
		return { actionText: segment.text };
	}

	const text = segment.text;
	const linkClose = text.indexOf("]]");
	if (linkClose === -1) {
		return { actionText: text };
	}

	const afterLink = text.slice(linkClose + 2);
	const separatorMatch = afterLink.match(/^\s*(?:—|--)\s*/);
	if (!separatorMatch) {
		return { actionText: text };
	}

	const prefixEnd = linkClose + 2 + separatorMatch[0].length;
	const mutedPrefix = text.slice(0, prefixEnd);
	const actionText = text.slice(prefixEnd).trim();
	if (!actionText) {
		return { actionText: text };
	}

	return { mutedPrefix, actionText };
}

export function splitFieldLines(raw: string): string[] {
	if (!raw) {
		return [];
	}

	return raw.split(/\r?\n/);
}

export function detectNewline(raw: string): string {
	return raw.includes("\r\n") ? "\r\n" : "\n";
}

export function parsePendingEditsField(
	scenePath: string,
	sceneTitle: string,
	sceneOrder: number,
	rawField: string,
): PendingEditSegment[] {
	const trimmedField = rawField?.trim() ?? "";
	if (!trimmedField) {
		return [];
	}

	const lines = splitFieldLines(rawField);
	const humanLines: string[] = [];
	const inquiryLines: string[] = [];

	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}

		if (isInquiryLine(line)) {
			inquiryLines.push(line);
		} else {
			humanLines.push(line);
		}
	}

	const segments: PendingEditSegment[] = [];

	if (humanLines.length > 0) {
		segments.push({
			id: `${scenePath}::human`,
			kind: "human",
			scenePath,
			sceneTitle,
			sceneOrder,
			text: humanLines.join("\n"),
			lines: [...humanLines],
		});
	}

	inquiryLines.forEach((line, index) => {
		segments.push({
			id: `${scenePath}::inquiry::${index}`,
			kind: "inquiry",
			scenePath,
			sceneTitle,
			sceneOrder,
			text: line,
			lines: [line],
		});
	});

	return segments;
}

export function hasPendingEdits(rawField: unknown): boolean {
	return typeof rawField === "string" && rawField.trim().length > 0;
}

export function readPendingEditsField(app: App, file: TFile): string {
	const cache = app.metadataCache.getFileCache(file);
	const raw = cache?.frontmatter?.[PENDING_EDITS_FRONTMATTER_KEY];
	return typeof raw === "string" ? raw : "";
}

export interface DrainResult {
	outcome: "written" | "skipped" | "not_found";
	nextValue: string;
}

export function computeFieldAfterDrain(
	rawField: string,
	segment: PendingEditSegment,
): DrainResult {
	const newline = detectNewline(rawField);
	const lines = splitFieldLines(rawField);

	if (segment.kind === "human") {
		const remaining = lines.filter((line) => !line.trim() || isInquiryLine(line));
		const next = remaining.join(newline).trim();
		if (next === (rawField ?? "").trim()) {
			return { outcome: "skipped", nextValue: rawField ?? "" };
		}
		return { outcome: "written", nextValue: next };
	}

	const [targetLine] = segment.lines;
	if (!targetLine) {
		return { outcome: "not_found", nextValue: rawField ?? "" };
	}

	const indexToRemove = lines.findIndex((line) => line === targetLine);
	if (indexToRemove === -1) {
		return { outcome: "not_found", nextValue: rawField ?? "" };
	}

	const remaining = lines.slice(0, indexToRemove).concat(lines.slice(indexToRemove + 1));
	const next = remaining.join(newline).trim();
	return { outcome: "written", nextValue: next };
}

export async function drainSegmentFromFrontmatter(
	app: App,
	file: TFile,
	segment: PendingEditSegment,
): Promise<DrainResult> {
	let result: DrainResult = { outcome: "skipped", nextValue: "" };

	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		const currentRaw = typeof frontmatter[PENDING_EDITS_FRONTMATTER_KEY] === "string"
			? (frontmatter[PENDING_EDITS_FRONTMATTER_KEY] as string)
			: "";
		result = computeFieldAfterDrain(currentRaw, segment);
		if (result.outcome === "written") {
			frontmatter[PENDING_EDITS_FRONTMATTER_KEY] = result.nextValue;
		}
	});

	return result;
}

export async function clearPendingEditsField(app: App, file: TFile): Promise<void> {
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (PENDING_EDITS_FRONTMATTER_KEY in frontmatter) {
			frontmatter[PENDING_EDITS_FRONTMATTER_KEY] = "";
		}
	});
}

export function buildSceneItems(
	sceneInputs: Array<{ path: string; title: string; order: number; rawField: string }>,
): PendingEditsSceneItem[] {
	// Deduplicate by scenePath. Upstream sources (e.g. radial-timeline's getSceneData)
	// can occasionally emit the same scene more than once; without this guard the queue
	// would contain duplicate segment IDs and Next would appear stuck because findIndex
	// always returns the first match.
	const byPath = new Map<string, PendingEditsSceneItem>();
	for (const input of sceneInputs) {
		if (byPath.has(input.path)) {
			continue;
		}
		const segments = parsePendingEditsField(input.path, input.title, input.order, input.rawField);
		if (segments.length === 0) {
			continue;
		}
		byPath.set(input.path, {
			scenePath: input.path,
			sceneTitle: input.title,
			sceneOrder: input.order,
			rawField: input.rawField,
			segments,
		});
	}
	return Array.from(byPath.values()).sort((a, b) => a.sceneOrder - b.sceneOrder);
}
