/**
 * In-memory Obsidian app factory for vitest.
 *
 * Use this when a unit covers code that touches `app.vault` or
 * `app.metadataCache` (e.g. ImportEngine, VaultScope helpers).
 *
 * Provide a list of scene specs and the factory returns an App-shaped
 * object backed by a Map<path, content>. Frontmatter is parsed by the
 * factory (no live YAML parser needed — pass it as a structured object).
 */
import { TFile } from "./obsidian";

export interface MockSceneSpec {
	path: string;
	body: string;
	frontmatter?: Record<string, unknown>;
}

interface MockEntry {
	file: TFile;
	frontmatter: Record<string, unknown>;
	body: string;
}

export interface MockApp {
	vault: {
		configDir: string;
		adapter: { read: (path: string) => Promise<string>; exists: (path: string) => Promise<boolean> };
		getMarkdownFiles(): TFile[];
		getAbstractFileByPath(path: string): TFile | null;
		read(file: TFile): Promise<string>;
		cachedRead(file: TFile): Promise<string>;
		process(file: TFile, mutator: (current: string) => string): Promise<void>;
	};
	metadataCache: {
		getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null;
		getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null;
	};
	plugins?: { getPlugin(id: string): unknown };
	workspace?: {
		getActiveFile(): TFile | null;
	};
	/** Test helper: synchronously read the current in-memory body for a file. */
	peek(path: string): string;
}

function buildBodyWithFrontmatter(spec: MockSceneSpec): string {
	if (!spec.frontmatter || Object.keys(spec.frontmatter).length === 0) {
		return spec.body;
	}
	const lines = ["---"];
	for (const [key, value] of Object.entries(spec.frontmatter)) {
		lines.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
	}
	lines.push("---", "");
	return `${lines.join("\n")}${spec.body}`;
}

function makeFile(path: string, content: string): TFile {
	const file = new TFile();
	file.path = path;
	const lastSlash = path.lastIndexOf("/");
	const tail = lastSlash === -1 ? path : path.slice(lastSlash + 1);
	const dot = tail.lastIndexOf(".");
	file.basename = dot === -1 ? tail : tail.slice(0, dot);
	file.extension = dot === -1 ? "" : tail.slice(dot + 1);
	file.stat = {
		ctime: Date.now(),
		mtime: Date.now(),
		size: content.length,
	};
	return file;
}

export function createMockApp(scenes: MockSceneSpec[]): MockApp {
	const entries = new Map<string, MockEntry>();
	for (const spec of scenes) {
		const fullContent = buildBodyWithFrontmatter(spec);
		const file = makeFile(spec.path, fullContent);
		entries.set(spec.path, {
			file,
			frontmatter: spec.frontmatter ?? {},
			body: fullContent,
		});
	}

	const updateBody = (path: string, next: string): void => {
		const entry = entries.get(path);
		if (!entry) return;
		entry.body = next;
		entry.file.stat = {
			...entry.file.stat,
			mtime: Date.now(),
			size: next.length,
		};
	};

	return {
		vault: {
			configDir: ".obsidian",
			adapter: {
				async read(_path: string): Promise<string> {
					throw new Error("MockApp adapter.read not configured");
				},
				async exists(_path: string): Promise<boolean> {
					return false;
				},
			},
			getMarkdownFiles(): TFile[] {
				return Array.from(entries.values()).map((entry) => entry.file);
			},
			getAbstractFileByPath(path: string): TFile | null {
				return entries.get(path)?.file ?? null;
			},
			async read(file: TFile): Promise<string> {
				return entries.get(file.path)?.body ?? "";
			},
			async cachedRead(file: TFile): Promise<string> {
				return entries.get(file.path)?.body ?? "";
			},
			async process(file: TFile, mutator: (current: string) => string): Promise<void> {
				const entry = entries.get(file.path);
				if (!entry) return;
				updateBody(file.path, mutator(entry.body));
			},
		},
		metadataCache: {
			getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null {
				const entry = entries.get(file.path);
				if (!entry) return null;
				return { frontmatter: entry.frontmatter };
			},
			getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
				// Naive resolution: match by basename or by exact path.
				for (const entry of entries.values()) {
					if (entry.file.basename === linkpath || entry.file.path === linkpath) {
						return entry.file;
					}
				}
				return null;
			},
		},
		peek(path: string): string {
			return entries.get(path)?.body ?? "";
		},
	};
}
