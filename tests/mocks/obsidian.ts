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

// Minimal ButtonComponent stub mirroring the chained API the modal footer
// primitive uses (setButtonText / setCta / onClick / setDisabled) plus a
// buttonEl with addClass. Records state so tests can assert behavior.
export class ButtonComponent {
	text = "";
	cta = false;
	disabled = false;
	clickHandler: (() => void) | null = null;
	readonly classes = new Set<string>();
	readonly buttonEl = { addClass: (cls: string): void => void this.classes.add(cls) };

	constructor(_parent: unknown) {}

	setButtonText(text: string): this {
		this.text = text;
		return this;
	}
	setCta(): this {
		this.cta = true;
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		return this;
	}
	onClick(cb: () => void): this {
		this.clickHandler = cb;
		return this;
	}
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

// Minimal Modal stub mirroring Obsidian's open()->onOpen / close()->onClose
// contract. contentEl only needs empty() for PromiseModal base tests.
export class Modal {
	app: App;
	contentEl: { empty(): void } = { empty(): void {} };

	constructor(app: App) {
		this.app = app;
	}

	open(): void {
		this.onOpen();
	}

	close(): void {
		this.onClose();
	}

	onOpen(): void {}
	onClose(): void {}
}
