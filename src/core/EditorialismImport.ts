// Extracts a Format B "editorialism file" (a standalone `type: editorialism`
// markdown document) from arbitrary pasted launcher text. This is the Format B
// counterpart to ReviewBlockFormat's review-block extraction: the launcher runs
// both over the same paste so one reply can carry a review block AND an
// editorialism agenda.
//
// Two detection paths, in order of confidence:
//   1. A fenced ```editorialism … ``` block (what the AI is instructed to emit).
//   2. Unfenced fallback: a `--- … type: editorialism … ---` frontmatter block,
//      taken from its opening fence to end-of-text. Many chat UIs strip outer
//      code fences on copy, so the unfenced path keeps the feature working —
//      the trade-off is that trailing chat commentary after the file can be
//      swept in, which the author trims after the file is created.
import { EDITORIALISM_TYPE_VALUE } from "../services/EditorialismService";

export const EDITORIALISM_FENCE = "editorialism";

export interface ExtractedEditorialismFile {
	/** The full markdown file content (frontmatter + body), fence removed. */
	content: string;
	/** Frontmatter `title:`, else the first `# ` heading, else a safe default. */
	title: string;
	/** Frontmatter `book:` (trimmed) or null when unset. */
	book: string | null;
}

const FRONTMATTER_FENCE = "---";

function readFrontmatter(content: string): Record<string, string> {
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== FRONTMATTER_FENCE) {
		return {};
	}
	const frontmatter: Record<string, string> = {};
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) {
			break;
		}
		if (line.trim() === FRONTMATTER_FENCE) {
			return frontmatter;
		}
		const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
		if (match && match[1] !== undefined && match[2] !== undefined) {
			frontmatter[match[1].toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, "");
		}
	}
	// Unterminated frontmatter — treat as none.
	return {};
}

function hasEditorialismType(frontmatter: Record<string, string>): boolean {
	return (frontmatter.type ?? "").trim().toLowerCase() === EDITORIALISM_TYPE_VALUE;
}

function deriveTitleFromBody(content: string): string | null {
	for (const line of content.split(/\r?\n/)) {
		const match = line.match(/^#\s+(.+?)\s*#*\s*$/);
		if (match && match[1]) {
			return match[1].trim();
		}
	}
	return null;
}

function matchFencedEditorialism(rawText: string): string | null {
	const pattern = new RegExp(
		`(?:^|\\n)\`\`\`${EDITORIALISM_FENCE}[^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\``,
		"m",
	);
	const match = pattern.exec(rawText);
	return match?.[1] ?? null;
}

// Finds the first `---` frontmatter block whose `type` is editorialism and
// returns everything from that opening fence to end-of-text.
function matchUnfencedEditorialism(rawText: string): string | null {
	const lines = rawText.replace(/\r\n/g, "\n").split("\n");
	for (let open = 0; open < lines.length; open++) {
		if (lines[open]?.trim() !== FRONTMATTER_FENCE) {
			continue;
		}
		for (let close = open + 1; close < lines.length; close++) {
			if (lines[close]?.trim() !== FRONTMATTER_FENCE) {
				continue;
			}
			const frontmatterText = lines.slice(open, close + 1).join("\n");
			if (hasEditorialismType(readFrontmatter(frontmatterText))) {
				return lines.slice(open).join("\n");
			}
			break;
		}
	}
	return null;
}

// Drops a trailing standalone ``` fence (left over when the unfenced fallback
// grabs a block that was fenced in the chat) plus surrounding blank lines.
function stripTrailingFence(content: string): string {
	return content.replace(/\n```[^\S\r\n]*\s*$/, "").trimEnd();
}

export function extractEditorialismFileFromText(rawText: string): ExtractedEditorialismFile | null {
	if (!rawText || !rawText.trim()) {
		return null;
	}

	let content = matchFencedEditorialism(rawText);
	if (content && !hasEditorialismType(readFrontmatter(content.trim()))) {
		// A fenced ```editorialism block that isn't actually an editorialism file
		// (no/incorrect frontmatter) — fall through to the unfenced scan.
		content = null;
	}
	if (!content) {
		content = matchUnfencedEditorialism(rawText);
	}
	if (!content) {
		return null;
	}

	const trimmed = stripTrailingFence(content).trim();
	const frontmatter = readFrontmatter(trimmed);
	if (!hasEditorialismType(frontmatter)) {
		return null;
	}

	const title = frontmatter.title?.trim() || deriveTitleFromBody(trimmed) || "Editorialism";
	const book = frontmatter.book?.trim() || null;
	return { content: trimmed, title, book };
}
