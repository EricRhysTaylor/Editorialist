/**
 * Minimal stub of the Obsidian API for vitest.
 * Only includes the surface area touched by unit-tested modules.
 * Expand as more tests come online.
 */

export class TFile {
	path = "";
	basename = "";
	extension = "";
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class Notice {
	constructor(_message: string, _timeout?: number) {}
	setMessage(_message: string): this {
		return this;
	}
	hide(): void {}
}

export class Plugin {
	app: unknown = {};
	manifest: unknown = {};
	addCommand(_command: unknown): void {}
	addRibbonIcon(_icon: string, _title: string, _callback: () => void): HTMLElement {
		return {} as HTMLElement;
	}
	addSettingTab(_tab: unknown): void {}
	registerView(_type: string, _factory: unknown): void {}
	registerEditorExtension(_extension: unknown): void {}
	registerDomEvent(_target: unknown, _event: string, _handler: unknown): void {}
	registerEvent(_ref: unknown): void {}
	register(_cb: () => void): void {}
	async loadData(): Promise<unknown> {
		return {};
	}
	async saveData(_data: unknown): Promise<void> {}
}

export class MarkdownView {
	file: TFile | null = null;
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export type App = Record<string, unknown>;
