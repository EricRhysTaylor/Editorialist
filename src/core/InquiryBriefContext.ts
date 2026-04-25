import type { App, TFile } from "obsidian";

const SUMMARY_FRONTMATTER_KEYS = ["summary", "Summary", "brief", "Brief"];
const PARAGRAPH_CHAR_LIMIT = 600;

export interface InquiryBriefContext {
	noteTitle: string;
	notePath: string;
	summary: string;
}

interface CachedEntry {
	mtime: number;
	context: InquiryBriefContext | null;
}

/**
 * Resolve an Inquiry brief note's display summary.
 *
 * Inputs come from `extractInquiryBriefLinkTarget` (the wiki-link target).
 * Returns null when the note can't be resolved (link broken, file missing).
 *
 * Summary preference, in order:
 *   1. Frontmatter `summary` / `brief` field
 *   2. First non-empty paragraph of the note body, trimmed to PARAGRAPH_CHAR_LIMIT
 */
export class InquiryBriefResolver {
	private readonly cache = new Map<string, CachedEntry>();

	constructor(private readonly app: App) {}

	async resolve(linkTarget: string, sourcePath = ""): Promise<InquiryBriefContext | null> {
		const file = this.app.metadataCache.getFirstLinkpathDest(linkTarget, sourcePath);
		if (!file) {
			return null;
		}

		const cached = this.cache.get(file.path);
		if (cached && cached.mtime === file.stat.mtime) {
			return cached.context;
		}

		const context = await this.readContext(file);
		this.cache.set(file.path, { mtime: file.stat.mtime, context });
		return context;
	}

	clear(): void {
		this.cache.clear();
	}

	private async readContext(file: TFile): Promise<InquiryBriefContext | null> {
		const cache = this.app.metadataCache.getFileCache(file);
		const fmSummary = readFrontmatterSummary(cache?.frontmatter);
		if (fmSummary) {
			return {
				noteTitle: file.basename,
				notePath: file.path,
				summary: fmSummary,
			};
		}

		try {
			const content = await this.app.vault.cachedRead(file);
			const summary = extractFirstParagraph(content);
			if (!summary) {
				return null;
			}
			return {
				noteTitle: file.basename,
				notePath: file.path,
				summary,
			};
		} catch {
			return null;
		}
	}
}

function readFrontmatterSummary(frontmatter: Record<string, unknown> | undefined): string | null {
	if (!frontmatter) {
		return null;
	}
	for (const key of SUMMARY_FRONTMATTER_KEYS) {
		const value = frontmatter[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
}

export function extractFirstParagraph(content: string): string | null {
	const stripped = stripFrontmatterBlock(content).trim();
	if (!stripped) {
		return null;
	}

	const paragraphs = stripped.split(/\r?\n\s*\r?\n/);
	for (const paragraph of paragraphs) {
		const cleaned = paragraph
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#"))
			.join(" ")
			.trim();
		if (!cleaned) {
			continue;
		}
		if (cleaned.length <= PARAGRAPH_CHAR_LIMIT) {
			return cleaned;
		}
		return cleaned.slice(0, PARAGRAPH_CHAR_LIMIT - 1).trimEnd() + "…";
	}
	return null;
}

function stripFrontmatterBlock(content: string): string {
	if (!content.startsWith("---")) {
		return content;
	}
	const closing = content.indexOf("\n---", 3);
	if (closing === -1) {
		return content;
	}
	const after = content.indexOf("\n", closing + 4);
	return after === -1 ? "" : content.slice(after + 1);
}
