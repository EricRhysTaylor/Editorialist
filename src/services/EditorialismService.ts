import { TFile, TFolder, type App } from "obsidian";
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
		const contents = await this.app.vault.read(file);
		const next = rewriteTaskMarker(contents, lineIndex, nextStatus);
		if (next === contents) {
			return;
		}
		await this.app.vault.modify(file, next);
	}

	getRootFolderName(): string {
		return EDITORIALISM_FOLDER_NAME;
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
		const cachedType = cached?.frontmatter?.type;
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
