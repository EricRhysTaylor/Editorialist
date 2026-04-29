import type {
	Editorialism,
	EditorialismItem,
	EditorialismItemScope,
	EditorialismItemStatus,
	EditorialismSection,
} from "../models/Editorialism";

const TASK_LINE_PATTERN = /^\s*-\s\[(.)\]\s+(.*)$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FRONTMATTER_FENCE = "---";
const INLINE_METADATA_PATTERN = /\[([a-z][a-z0-9_-]*)::\s*([^\]]+?)\]/gi;
const SCOPE_RANGE_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*$/;
const SCOPE_SINGLE_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*$/;

export function statusFromMarker(marker: string): EditorialismItemStatus {
	switch (marker.toLowerCase()) {
		case "x":
			return "done";
		case "/":
			return "in-progress";
		case "-":
			return "deferred";
		case "?":
			return "question";
		default:
			return "open";
	}
}

export function markerFromStatus(status: EditorialismItemStatus): string {
	switch (status) {
		case "done":
			return "x";
		case "in-progress":
			return "/";
		case "deferred":
			return "-";
		case "question":
			return "?";
		case "open":
		default:
			return " ";
	}
}

export function parseScope(raw: string): EditorialismItemScope {
	const trimmed = raw.trim();
	const lower = trimmed.toLowerCase();
	if (lower === "manuscript" || lower === "mss" || lower === "book") {
		return { kind: "manuscript", raw: trimmed };
	}
	if (lower.startsWith("arc:")) {
		const arcName = trimmed.slice(4).trim();
		return { kind: "arc", arcName, raw: trimmed };
	}
	const rangeMatch = trimmed.match(SCOPE_RANGE_PATTERN);
	if (rangeMatch) {
		return { kind: "range", start: rangeMatch[1], end: rangeMatch[2], raw: trimmed };
	}
	const singleMatch = trimmed.match(SCOPE_SINGLE_PATTERN);
	if (singleMatch) {
		return { kind: "scene", scene: singleMatch[1], raw: trimmed };
	}
	return { kind: "unknown", raw: trimmed };
}

function parseTaskLine(body: string): { text: string; scope: EditorialismItemScope | null; tags: string[] } {
	const tags: string[] = [];
	let scope: EditorialismItemScope | null = null;
	const stripped = body.replace(INLINE_METADATA_PATTERN, (_match, key: string, value: string) => {
		const lowerKey = key.toLowerCase();
		const trimmedValue = value.trim();
		if (lowerKey === "scope") {
			scope = parseScope(trimmedValue);
		} else if (lowerKey === "tags" || lowerKey === "tag") {
			for (const part of trimmedValue.split(/[,\s]+/)) {
				const value = part.trim();
				if (value.length > 0) {
					tags.push(value);
				}
			}
		}
		return "";
	}).trim();
	return { text: stripped, scope, tags };
}

interface FrontmatterParseResult {
	frontmatter: Record<string, string>;
	bodyStartLine: number;
}

function parseFrontmatter(lines: ReadonlyArray<string>): FrontmatterParseResult {
	if (lines[0]?.trim() !== FRONTMATTER_FENCE) {
		return { frontmatter: {}, bodyStartLine: 0 };
	}
	const frontmatter: Record<string, string> = {};
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) {
			break;
		}
		if (line.trim() === FRONTMATTER_FENCE) {
			return { frontmatter, bodyStartLine: i + 1 };
		}
		const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
		if (match && match[1] !== undefined && match[2] !== undefined) {
			const value = match[2].trim().replace(/^["']|["']$/g, "");
			frontmatter[match[1].toLowerCase()] = value;
		}
	}
	return { frontmatter: {}, bodyStartLine: 0 };
}

export function parseEditorialism(filePath: string, contents: string): Editorialism {
	const lines = contents.split(/\r?\n/);
	const { frontmatter, bodyStartLine } = parseFrontmatter(lines);

	const sections: EditorialismSection[] = [];
	let currentSection: EditorialismSection | null = null;
	let titleFromHeading: string | null = null;

	const ensureSection = (heading: string): EditorialismSection => {
		const section: EditorialismSection = { heading, items: [] };
		sections.push(section);
		return section;
	};

	for (let lineIndex = bodyStartLine; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		if (line === undefined) {
			continue;
		}
		const headingMatch = line.match(HEADING_PATTERN);
		if (headingMatch && headingMatch[1] !== undefined && headingMatch[2] !== undefined) {
			const level = headingMatch[1].length;
			const text = headingMatch[2].trim();
			if (level === 1 && titleFromHeading === null) {
				titleFromHeading = text;
				continue;
			}
			currentSection = ensureSection(text);
			continue;
		}
		const taskMatch = line.match(TASK_LINE_PATTERN);
		if (!taskMatch || taskMatch[1] === undefined || taskMatch[2] === undefined) {
			continue;
		}
		const status = statusFromMarker(taskMatch[1]);
		const parsed = parseTaskLine(taskMatch[2]);
		if (!currentSection) {
			currentSection = ensureSection("Items");
		}
		const item: EditorialismItem = {
			lineIndex,
			status,
			text: parsed.text,
			scope: parsed.scope,
			tags: parsed.tags,
		};
		currentSection.items.push(item);
	}

	const baseName = filePath.split("/").pop()?.replace(/\.md$/i, "") ?? "Untitled";
	const title = (frontmatter.title?.trim()) || titleFromHeading || baseName;

	return {
		filePath,
		title,
		book: frontmatter.book?.trim() || null,
		status: frontmatter.status?.trim() || null,
		created: frontmatter.created?.trim() || null,
		sections,
	};
}

export function rewriteTaskMarker(
	contents: string,
	lineIndex: number,
	nextStatus: EditorialismItemStatus,
): string {
	const lines = contents.split(/\r?\n/);
	if (lineIndex < 0 || lineIndex >= lines.length) {
		return contents;
	}
	const line = lines[lineIndex];
	if (line === undefined) {
		return contents;
	}
	const match = line.match(TASK_LINE_PATTERN);
	if (!match) {
		return contents;
	}
	const marker = markerFromStatus(nextStatus);
	const indentMatch = line.match(/^\s*-\s/);
	const indent = indentMatch ? indentMatch[0] : "- ";
	lines[lineIndex] = line.replace(TASK_LINE_PATTERN, (_full, _marker, body: string) => {
		return `${indent}[${marker}] ${body}`;
	});
	return lines.join("\n");
}
