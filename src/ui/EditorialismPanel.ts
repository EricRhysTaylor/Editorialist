import { ItemView, TFile, setIcon, type WorkspaceLeaf } from "obsidian";
import type EditorialistPlugin from "../main";
import type {
	Editorialism,
	EditorialismItem,
	EditorialismItemStatus,
	EditorialismSummary,
} from "../models/Editorialism";

export const EDITORIALISM_PANEL_VIEW_TYPE = "editorialist-editorialism-panel";

const STATUS_CYCLE: EditorialismItemStatus[] = [
	"open",
	"in-progress",
	"done",
	"deferred",
	"question",
];

const STATUS_LABEL: Record<EditorialismItemStatus, string> = {
	"open": "Open",
	"in-progress": "In progress",
	"done": "Done",
	"deferred": "Deferred",
	"question": "Question",
};

const STATUS_ICON: Record<EditorialismItemStatus, string> = {
	"open": "circle",
	"in-progress": "circle-dashed",
	"done": "check-circle-2",
	"deferred": "circle-slash",
	"question": "circle-help",
};

export class EditorialismPanel extends ItemView {
	private summaries: EditorialismSummary[] = [];
	private activeFilePath: string | null = null;
	private activeEditorialism: Editorialism | null = null;
	private isLoading = false;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: EditorialistPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return EDITORIALISM_PANEL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Editorialisms";
	}

	getIcon(): string {
		return "list-checks";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("editorialist-editorialism-panel");
		this.registerEvent(this.app.vault.on("modify", (file) => {
			if (file instanceof TFile && file.path.startsWith(this.plugin.getEditorialismFolder() + "/")) {
				void this.refresh();
			}
		}));
		this.registerEvent(this.app.vault.on("create", (file) => {
			if (file instanceof TFile && file.path.startsWith(this.plugin.getEditorialismFolder() + "/")) {
				void this.refresh();
			}
		}));
		this.registerEvent(this.app.vault.on("delete", (file) => {
			if (file instanceof TFile && file.path === this.activeFilePath) {
				this.activeFilePath = null;
				this.activeEditorialism = null;
			}
			if (file instanceof TFile && file.path.startsWith(this.plugin.getEditorialismFolder() + "/")) {
				void this.refresh();
			}
		}));
		await this.refresh();
	}

	async refresh(): Promise<void> {
		if (this.isLoading) {
			return;
		}
		this.isLoading = true;
		try {
			const book = this.plugin.getActiveBookScopeInfo().label;
			this.summaries = await this.plugin.listEditorialismsForActiveBook(book);
			if (this.activeFilePath) {
				this.activeEditorialism = await this.plugin.loadEditorialism(this.activeFilePath);
				if (!this.activeEditorialism) {
					this.activeFilePath = null;
				}
			}
			this.render();
		} finally {
			this.isLoading = false;
		}
	}

	private render(): void {
		this.contentEl.empty();
		const shell = this.contentEl.createDiv({ cls: "editorialist-editorialism-panel__shell" });
		this.renderHeader(shell);
		if (this.activeEditorialism) {
			this.renderDetail(shell, this.activeEditorialism);
		} else {
			this.renderList(shell);
		}
	}

	private renderHeader(parent: HTMLElement): void {
		const header = parent.createDiv({ cls: "editorialist-editorialism-panel__header" });
		const titleRow = header.createDiv({ cls: "editorialist-editorialism-panel__title-row" });
		const icon = titleRow.createSpan({ cls: "editorialist-editorialism-panel__title-icon" });
		setIcon(icon, "list-checks");
		titleRow.createEl("h2", { text: "Editorialisms" });

		const book = this.plugin.getActiveBookScopeInfo().label;
		header.createDiv({
			cls: "editorialist-editorialism-panel__subtitle",
			text: book ? `Active book: ${book}` : "No active book selected",
		});
	}

	private renderList(parent: HTMLElement): void {
		if (this.summaries.length === 0) {
			this.renderEmptyState(parent);
			return;
		}
		const list = parent.createDiv({ cls: "editorialist-editorialism-panel__list" });
		for (const summary of this.summaries) {
			const row = list.createDiv({ cls: "editorialist-editorialism-panel__list-row" });
			row.addEventListener("click", () => {
				this.activeFilePath = summary.filePath;
				void this.refresh();
			});
			const main = row.createDiv({ cls: "editorialist-editorialism-panel__list-main" });
			main.createDiv({
				cls: "editorialist-editorialism-panel__list-title",
				text: summary.title,
			});
			const meta = main.createDiv({ cls: "editorialist-editorialism-panel__list-meta" });
			meta.createSpan({
				text: `${summary.doneItems} / ${summary.totalItems} done`,
			});
			if (summary.status) {
				meta.createSpan({
					cls: "editorialist-editorialism-panel__list-status",
					text: summary.status,
				});
			}
			const progress = row.createDiv({ cls: "editorialist-editorialism-panel__list-progress" });
			const fraction = summary.totalItems > 0 ? summary.doneItems / summary.totalItems : 0;
			const fill = progress.createDiv({ cls: "editorialist-editorialism-panel__list-progress-fill" });
			fill.style.setProperty("--editorialist-progress", `${Math.round(fraction * 100)}%`);
		}
	}

	private renderEmptyState(parent: HTMLElement): void {
		const empty = parent.createDiv({ cls: "editorialist-editorialism-panel__empty" });
		empty.createDiv({
			cls: "editorialist-editorialism-panel__empty-title",
			text: "No Editorialisms yet",
		});
		const folder = this.plugin.getEditorialismFolder();
		const book = this.plugin.getActiveBookScopeInfo().label;
		const path = book ? `${folder}/${book}/` : `${folder}/<book>/`;
		empty.createDiv({
			cls: "editorialist-editorialism-panel__empty-copy",
			text: `Create a markdown file under ${path} with frontmatter type: editorialism to start an agenda.`,
		});
	}

	private renderDetail(parent: HTMLElement, editorialism: Editorialism): void {
		const detail = parent.createDiv({ cls: "editorialist-editorialism-panel__detail" });

		const back = detail.createEl("button", {
			cls: "editorialist-editorialism-panel__back",
			attr: { type: "button" },
		});
		const backIcon = back.createSpan({ cls: "editorialist-editorialism-panel__back-icon" });
		setIcon(backIcon, "arrow-left");
		back.createSpan({ text: "All Editorialisms" });
		back.addEventListener("click", () => {
			this.activeFilePath = null;
			this.activeEditorialism = null;
			this.render();
		});

		const titleRow = detail.createDiv({ cls: "editorialist-editorialism-panel__detail-title-row" });
		titleRow.createEl("h3", {
			cls: "editorialist-editorialism-panel__detail-title",
			text: editorialism.title,
		});
		const openSource = titleRow.createEl("button", {
			cls: "editorialist-editorialism-panel__detail-open",
			attr: {
				type: "button",
				"aria-label": "Open source markdown",
				title: "Open source markdown",
			},
		});
		const openIcon = openSource.createSpan({ cls: "editorialist-editorialism-panel__detail-open-icon" });
		setIcon(openIcon, "external-link");
		openSource.addEventListener("click", () => {
			void this.app.workspace.openLinkText(editorialism.filePath, editorialism.filePath, false);
		});

		const subtitle = detail.createDiv({ cls: "editorialist-editorialism-panel__detail-subtitle" });
		const totals = this.computeTotals(editorialism);
		subtitle.createSpan({
			text: `${totals.done} / ${totals.total} done`,
		});
		if (editorialism.book) {
			subtitle.createSpan({
				cls: "editorialist-editorialism-panel__detail-meta-chip",
				text: editorialism.book,
			});
		}
		if (editorialism.status) {
			subtitle.createSpan({
				cls: "editorialist-editorialism-panel__detail-meta-chip",
				text: editorialism.status,
			});
		}

		for (const section of editorialism.sections) {
			const sectionEl = detail.createDiv({ cls: "editorialist-editorialism-panel__section" });
			sectionEl.createDiv({
				cls: "editorialist-editorialism-panel__section-heading",
				text: section.heading,
			});
			for (const item of section.items) {
				this.renderItem(sectionEl, editorialism, item);
			}
		}
	}

	private renderItem(parent: HTMLElement, editorialism: Editorialism, item: EditorialismItem): void {
		const row = parent.createDiv({
			cls: `editorialist-editorialism-panel__item editorialist-editorialism-panel__item--${item.status}`,
		});
		const checkbox = row.createEl("button", {
			cls: "editorialist-editorialism-panel__item-status",
			attr: {
				type: "button",
				"aria-label": `Status: ${STATUS_LABEL[item.status]} (click to advance)`,
				title: `${STATUS_LABEL[item.status]} — click to advance`,
			},
		});
		const checkboxIcon = checkbox.createSpan({ cls: "editorialist-editorialism-panel__item-status-icon" });
		setIcon(checkboxIcon, STATUS_ICON[item.status]);
		checkbox.addEventListener("click", (event) => {
			event.preventDefault();
			void this.advanceItemStatus(editorialism.filePath, item);
		});

		const main = row.createDiv({ cls: "editorialist-editorialism-panel__item-main" });
		main.createDiv({
			cls: "editorialist-editorialism-panel__item-text",
			text: item.text,
		});

		const chips = main.createDiv({ cls: "editorialist-editorialism-panel__item-chips" });
		if (item.scope) {
			this.renderScopeChip(chips, item, editorialism);
		}
		for (const tag of item.tags) {
			const chip = chips.createSpan({ cls: "editorialist-editorialism-panel__tag-chip" });
			chip.createSpan({ text: tag });
		}
	}

	private renderScopeChip(parent: HTMLElement, item: EditorialismItem, editorialism: Editorialism): void {
		if (!item.scope) {
			return;
		}
		const scope = item.scope;
		const chip = parent.createSpan({
			cls: `editorialist-editorialism-panel__scope-chip editorialist-editorialism-panel__scope-chip--${scope.kind}`,
		});
		const bar = chip.createSpan({ cls: "editorialist-editorialism-panel__scope-bar" });
		const fill = bar.createSpan({ cls: "editorialist-editorialism-panel__scope-bar-fill" });
		switch (scope.kind) {
			case "manuscript":
				fill.style.setProperty("--editorialist-scope-start", "0%");
				fill.style.setProperty("--editorialist-scope-end", "100%");
				break;
			case "scene":
				fill.style.setProperty("--editorialist-scope-start", "45%");
				fill.style.setProperty("--editorialist-scope-end", "55%");
				break;
			case "range":
				fill.style.setProperty("--editorialist-scope-start", "10%");
				fill.style.setProperty("--editorialist-scope-end", "90%");
				break;
			case "arc":
				fill.style.setProperty("--editorialist-scope-start", "20%");
				fill.style.setProperty("--editorialist-scope-end", "80%");
				break;
			default:
				fill.style.setProperty("--editorialist-scope-start", "0%");
				fill.style.setProperty("--editorialist-scope-end", "0%");
		}
		const label = chip.createSpan({ cls: "editorialist-editorialism-panel__scope-label" });
		label.setText(this.formatScopeLabel(scope, editorialism));
	}

	private formatScopeLabel(
		scope: NonNullable<EditorialismItem["scope"]>,
		_editorialism: Editorialism,
	): string {
		switch (scope.kind) {
			case "manuscript":
				return "Manuscript";
			case "scene":
				return `Scene ${scope.scene}`;
			case "range":
				return `Scenes ${scope.start}–${scope.end}`;
			case "arc":
				return scope.arcName ? `Arc: ${scope.arcName}` : "Arc";
			default:
				return scope.raw;
		}
	}

	private async advanceItemStatus(filePath: string, item: EditorialismItem): Promise<void> {
		const currentIndex = STATUS_CYCLE.indexOf(item.status);
		const nextIndex = (currentIndex + 1) % STATUS_CYCLE.length;
		const next = STATUS_CYCLE[nextIndex] ?? "open";
		await this.plugin.setEditorialismItemStatus(filePath, item.lineIndex, next);
		await this.refresh();
	}

	private computeTotals(editorialism: Editorialism): { total: number; done: number } {
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
		return { total, done };
	}
}
