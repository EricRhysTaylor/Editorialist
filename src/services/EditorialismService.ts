import { normalizePath, TFile, TFolder, type App } from "obsidian";
import {
	parseEditorialism,
	rewriteTaskMarker,
} from "../core/EditorialismParser";
import type {
	Editorialism,
	EditorialismItemStatus,
	EditorialismSummary,
} from "../models/Editorialism";

export const EDITORIALISM_FOLDER_NAME = "Editorialist";
export const EDITORIALISM_TYPE_VALUE = "editorialism";

export interface SaveEditorialismResult {
	filePath: string;
	created: boolean;
}

// Reduce a frontmatter value (book / title) to a single safe path segment:
// strip characters Obsidian/most filesystems reject, collapse whitespace, and
// trim leading/trailing dots and spaces so the result is a usable folder/file
// name.
function sanitizePathSegment(value: string): string {
	return value
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[.\s]+|[.\s]+$/g, "")
		.trim();
}

export class EditorialismService {
	constructor(private readonly app: App) {}

	async listForBook(bookLabel: string | null): Promise<EditorialismSummary[]> {
		const files = this.collectCandidateFiles();
		const summaries: EditorialismSummary[] = [];
		for (const file of files) {
			const editorialism = await this.tryLoad(file);
			if (!editorialism) {
				continue;
			}
			if (bookLabel && editorialism.book && editorialism.book.trim() !== bookLabel.trim()) {
				continue;
			}
			summaries.push(this.summarize(editorialism, file.stat.mtime));
		}
		return summaries.sort((left, right) => right.mtime - left.mtime);
	}

	async load(filePath: string): Promise<Editorialism | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return null;
		}
		return this.tryLoad(file);
	}

	async setItemStatus(
		filePath: string,
		lineIndex: number,
		nextStatus: EditorialismItemStatus,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return;
		}
		await this.app.vault.process(file, (currentText) =>
			rewriteTaskMarker(currentText, lineIndex, nextStatus),
		);
	}

	getRootFolderName(): string {
		return EDITORIALISM_FOLDER_NAME;
	}

	// Write an extracted editorialism file to its conventional home:
	// `Editorialist/<Book>/<Title>.md` (book folder omitted when unknown).
	// Folders are created as needed. The path is deterministic from book+title,
	// so re-saving an updated version of the same agenda overwrites in place —
	// matching the "save over the prior version, same path" workflow.
	async saveEditorialismFile(file: {
		content: string;
		title: string;
		book: string | null;
	}): Promise<SaveEditorialismResult> {
		const folderSegments = [EDITORIALISM_FOLDER_NAME];
		const bookSegment = file.book ? sanitizePathSegment(file.book) : "";
		if (bookSegment) {
			folderSegments.push(bookSegment);
		}
		const folderPath = normalizePath(folderSegments.join("/"));
		await this.ensureFolderExists(folderPath);

		const fileName = `${sanitizePathSegment(file.title) || "Editorialism"}.md`;
		const filePath = normalizePath(`${folderPath}/${fileName}`);
		const body = file.content.endsWith("\n") ? file.content : `${file.content}\n`;

		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, body);
			return { filePath, created: false };
		}
		await this.app.vault.create(filePath, body);
		return { filePath, created: true };
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		if (!folderPath) {
			return;
		}
		if (this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder) {
			return;
		}
		// Build nested folders segment-by-segment; createFolder rejects when a
		// folder already exists, so each level is guarded by an existence check.
		const segments = folderPath.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (this.app.vault.getAbstractFileByPath(current) instanceof TFolder) {
				continue;
			}
			try {
				await this.app.vault.createFolder(current);
			} catch (error) {
				if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) {
					throw error;
				}
			}
		}
	}

	private collectCandidateFiles(): TFile[] {
		const root = this.app.vault.getAbstractFileByPath(EDITORIALISM_FOLDER_NAME);
		if (!(root instanceof TFolder)) {
			return [];
		}
		const out: TFile[] = [];
		const walk = (folder: TFolder): void => {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension.toLowerCase() === "md") {
					out.push(child);
				} else if (child instanceof TFolder) {
					walk(child);
				}
			}
		};
		walk(root);
		return out;
	}

	private async tryLoad(file: TFile): Promise<Editorialism | null> {
		const cached = this.app.metadataCache.getFileCache(file);
		const cachedType: unknown = cached?.frontmatter?.type;
		// Cheap precheck: if frontmatter is in metadata cache and `type:` is set
		// to anything other than the expected value, skip parsing.
		if (typeof cachedType === "string" && cachedType.trim().toLowerCase() !== EDITORIALISM_TYPE_VALUE) {
			return null;
		}
		const contents = await this.app.vault.cachedRead(file);
		// Source-of-truth check: parse the frontmatter ourselves to confirm. Files
		// without `type: editorialism` are silently skipped.
		if (!/^---[\s\S]*?\btype\s*:\s*["']?editorialism["']?\s*\n[\s\S]*?---/m.test(contents)) {
			return null;
		}
		return parseEditorialism(file.path, contents);
	}

	private summarize(editorialism: Editorialism, mtime: number): EditorialismSummary {
		let total = 0;
		let done = 0;
		for (const section of editorialism.sections) {
			for (const item of section.items) {
				total += 1;
				if (item.status === "done") {
					done += 1;
				}
			}
		}
		return {
			filePath: editorialism.filePath,
			title: editorialism.title,
			book: editorialism.book,
			status: editorialism.status,
			totalItems: total,
			doneItems: done,
			mtime,
		};
	}
}
