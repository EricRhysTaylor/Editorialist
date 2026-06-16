import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { EditorialismService } from "./EditorialismService";

// Minimal in-memory vault exercising the create/modify/createFolder surface the
// save method touches.
class FakeVault {
	folders = new Set<string>();
	files = new Map<string, TFile>();
	contents = new Map<string, string>();

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		const file = this.files.get(path);
		if (file) {
			return file;
		}
		if (this.folders.has(path)) {
			const folder = new TFolder();
			folder.path = path;
			return folder;
		}
		return null;
	}

	async createFolder(path: string): Promise<void> {
		if (this.folders.has(path)) {
			throw new Error("folder exists");
		}
		this.folders.add(path);
	}

	async create(path: string, data: string): Promise<TFile> {
		const file = new TFile();
		file.path = path;
		file.extension = "md";
		file.basename = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
		this.files.set(path, file);
		this.contents.set(path, data);
		return file;
	}

	async modify(file: TFile, data: string): Promise<void> {
		this.contents.set(file.path, data);
	}
}

function makeService(): { service: EditorialismService; vault: FakeVault } {
	const vault = new FakeVault();
	const service = new EditorialismService({ vault } as unknown as App);
	return { service, vault };
}

describe("EditorialismService.saveEditorialismFile", () => {
	it("writes to Editorialist/<Book>/<Title>.md and creates folders", async () => {
		const { service, vault } = makeService();
		const result = await service.saveEditorialismFile({
			content: "---\ntype: editorialism\ntitle: IT Subplot\nbook: Shail + Trisan\n---\n# IT Subplot",
			title: "IT Subplot",
			book: "Shail + Trisan",
		});

		expect(result.filePath).toBe("Editorialist/Shail + Trisan/IT Subplot.md");
		expect(result.created).toBe(true);
		expect(vault.folders.has("Editorialist")).toBe(true);
		expect(vault.folders.has("Editorialist/Shail + Trisan")).toBe(true);
		expect(vault.contents.get("Editorialist/Shail + Trisan/IT Subplot.md")).toContain("type: editorialism");
	});

	it("omits the book subfolder when book is null", async () => {
		const { service } = makeService();
		const result = await service.saveEditorialismFile({
			content: "---\ntype: editorialism\ntitle: Loose Notes\n---\n# Loose Notes",
			title: "Loose Notes",
			book: null,
		});
		expect(result.filePath).toBe("Editorialist/Loose Notes.md");
	});

	it("sanitizes illegal path characters in book and title", async () => {
		const { service } = makeService();
		const result = await service.saveEditorialismFile({
			content: "x",
			title: "Act 2: the middle / part?",
			book: "Book*One",
		});
		expect(result.filePath).toBe("Editorialist/Book One/Act 2 the middle part.md");
	});

	it("overwrites the same path in place on re-save (created=false)", async () => {
		const { service, vault } = makeService();
		const file = {
			content: "v1",
			title: "Agenda",
			book: "Book One",
		};
		const first = await service.saveEditorialismFile(file);
		expect(first.created).toBe(true);

		const second = await service.saveEditorialismFile({ ...file, content: "v2 superseding" });
		expect(second.created).toBe(false);
		expect(second.filePath).toBe(first.filePath);
		expect(vault.contents.get(first.filePath)).toContain("v2 superseding");
		// Exactly one file at that path — not a duplicate.
		expect([...vault.files.keys()].filter((p) => p === first.filePath)).toHaveLength(1);
	});

	it("ensures the saved content ends with a trailing newline", async () => {
		const { service, vault } = makeService();
		const result = await service.saveEditorialismFile({ content: "no newline", title: "T", book: null });
		expect(vault.contents.get(result.filePath)).toBe("no newline\n");
	});
});
