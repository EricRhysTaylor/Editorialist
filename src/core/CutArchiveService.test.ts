import { describe, expect, it } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import {
	CutArchiveService,
	formatCutBlock,
	resolveCutFilePath,
	resolveCutFolderPath,
	type CutBlockMetadata,
} from "./CutArchiveService";
import type { ActiveBookScopeInfo } from "./VaultScope";

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	const name = path.split("/").pop() ?? path;
	file.basename = name.replace(/\.md$/, "");
	file.extension = "md";
	return file;
}

// Minimal in-memory vault implementing only the surface CutArchiveService uses.
class FakeVault {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		if (this.files.has(path)) {
			return makeFile(path);
		}
		if (this.folders.has(path)) {
			const folder = new TFolder();
			folder.path = path;
			return folder;
		}
		return null;
	}

	async create(path: string, content: string): Promise<TFile> {
		if (this.files.has(path)) {
			throw new Error(`File already exists: ${path}`);
		}
		this.files.set(path, content);
		return makeFile(path);
	}

	async process(file: TFile, fn: (current: string) => string): Promise<string> {
		const next = fn(this.files.get(file.path) ?? "");
		this.files.set(file.path, next);
		return next;
	}

	async createFolder(path: string): Promise<void> {
		if (this.folders.has(path)) {
			throw new Error(`Folder already exists: ${path}`);
		}
		this.folders.add(path);
	}
}

function makeService(
	vault: FakeVault,
	options: { override?: string; sourceFolder?: string | null } = {},
): CutArchiveService {
	const scope: ActiveBookScopeInfo = {
		label: options.sourceFolder ? "Book" : null,
		sourceFolder: options.sourceFolder ?? null,
	};
	const app = { vault } as unknown as App;
	return new CutArchiveService(app, {
		getCutFolderOverride: () => options.override ?? "",
		getActiveBookScope: () => scope,
	});
}

const META: CutBlockMetadata = {
	source: "suggestion-target",
	scenePath: "Manuscript/Scene 1.md",
	backedUpAtIso: "2026-06-08T14:23:05Z",
	operation: "condense",
	suggestionId: "sug_1",
	contributor: "Claude Opus 4.8",
	reason: "Reduce pacing\nin the open",
};

describe("resolveCutFolderPath", () => {
	it("uses the explicit override when set", () => {
		expect(
			resolveCutFolderPath("Manuscript/Book/Scene 1.md", {
				override: "Archive/Cuts",
				sourceFolder: "Manuscript/Book",
			}),
		).toBe("Archive/Cuts");
	});

	it("uses the active book Cut folder only when the scene is inside the source folder", () => {
		expect(
			resolveCutFolderPath("Manuscript/Book/Scene 1.md", {
				override: "",
				sourceFolder: "Manuscript/Book",
			}),
		).toBe("Manuscript/Book/Cut");
	});

	it("falls back to the scene's own folder when it sits outside the active source folder", () => {
		expect(
			resolveCutFolderPath("Drafts/Loose/Scene 1.md", {
				override: "",
				sourceFolder: "Manuscript/Book",
			}),
		).toBe("Drafts/Loose/Cut");
	});

	it("falls back to the scene's own folder when there is no active source folder", () => {
		expect(
			resolveCutFolderPath("Drafts/Scene 1.md", { override: "", sourceFolder: null }),
		).toBe("Drafts/Cut");
	});
});

describe("resolveCutFilePath", () => {
	it("names the cut file after the scene basename inside the resolved folder", () => {
		expect(
			resolveCutFilePath("Manuscript/Book/37 Volcano.md", "37 Volcano", {
				override: "",
				sourceFolder: "Manuscript/Book",
			}),
		).toBe("Manuscript/Book/Cut/37 Volcano.md");
	});
});

describe("formatCutBlock", () => {
	it("emits a hidden metadata header, verbatim text, and a separator", () => {
		const block = formatCutBlock(META, "The original wording.");
		expect(block).toBe(
			[
				"%% editorialist-cut",
				"source: suggestion-target",
				"scene: Manuscript/Scene 1.md",
				"operation: condense",
				"suggestion-id: sug_1",
				"contributor: Claude Opus 4.8",
				"reason: Reduce pacing in the open",
				"backed-up: 2026-06-08T14:23:05Z",
				"%%",
				"",
				"The original wording.",
				"",
				"---",
				"",
			].join("\n"),
		);
	});

	it("sanitizes metadata values so they cannot break out of the %% comment", () => {
		const block = formatCutBlock(
			{
				source: "selection",
				scenePath: "S.md",
				backedUpAtIso: "2026-06-08T00:00:00Z",
				contributor: "Bad %%\nname",
				reason: "line one\nline two",
			},
			"text",
		);
		expect(block).toContain("contributor: Bad % % name");
		expect(block).toContain("reason: line one line two");
		// The only %% tokens left are the opening and closing comment fences.
		expect(block.match(/%%/g)?.length).toBe(2);
	});

	it("omits optional metadata lines that are not provided", () => {
		const block = formatCutBlock(
			{ source: "selection", scenePath: "S.md", backedUpAtIso: "2026-06-08T00:00:00Z" },
			"text",
		);
		expect(block).not.toContain("operation:");
		expect(block).not.toContain("suggestion-id:");
		expect(block).not.toContain("contributor:");
		expect(block).not.toContain("reason:");
		expect(block).toContain("source: selection");
	});
});

describe("CutArchiveService.backup", () => {
	it("creates a new cut file with Class: Cut frontmatter and the first block", async () => {
		const vault = new FakeVault();
		const service = makeService(vault, { sourceFolder: "Manuscript" });
		const result = await service.backup({
			...META,
			sceneFile: makeFile("Manuscript/Scene 1.md"),
			text: "Kept prose.",
		});

		expect(result.created).toBe(true);
		expect(result.cutFilePath).toBe("Manuscript/Cut/Scene 1.md");
		const content = vault.files.get("Manuscript/Cut/Scene 1.md") ?? "";
		expect(content.startsWith("---\nClass: Cut\n---\n")).toBe(true);
		expect(content).toContain("Kept prose.");
		expect(vault.folders.has("Manuscript/Cut")).toBe(true);
	});

	it("appends to an existing cut file without duplicating frontmatter", async () => {
		const vault = new FakeVault();
		const service = makeService(vault, { sourceFolder: "Manuscript" });
		const scene = makeFile("Manuscript/Scene 1.md");

		await service.backup({ ...META, sceneFile: scene, text: "First cut." });
		const second = await service.backup({ ...META, sceneFile: scene, text: "Second cut." });

		expect(second.created).toBe(false);
		const content = vault.files.get("Manuscript/Cut/Scene 1.md") ?? "";
		expect(content.match(/Class: Cut/g)?.length).toBe(1);
		expect(content).toContain("First cut.");
		expect(content).toContain("Second cut.");
		expect(content.indexOf("First cut.")).toBeLessThan(content.indexOf("Second cut."));
	});

	it("creates nested cut folders that do not yet exist", async () => {
		const vault = new FakeVault();
		const service = makeService(vault, { override: "Archive/Deep/Cuts" });
		await service.backup({
			...META,
			sceneFile: makeFile("Anywhere/Scene 9.md"),
			text: "x",
		});

		expect(vault.folders.has("Archive")).toBe(true);
		expect(vault.folders.has("Archive/Deep")).toBe(true);
		expect(vault.folders.has("Archive/Deep/Cuts")).toBe(true);
		expect(vault.files.has("Archive/Deep/Cuts/Scene 9.md")).toBe(true);
	});
});
