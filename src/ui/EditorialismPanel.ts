import { ItemView, TFile, setIcon, type WorkspaceLeaf } from "obsidian";
import type EditorialistPlugin from "../main";
import { EDITORIALIST_ICON_ID } from "./EditorialistLogoIcon";
import { formatEffortDuration } from "../core/EffortEstimate";
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

function formatWords(words: number): string {
	if (words < 1000) {
		return `${words} words`;
	}
	const thousands = (words / 1000).toFixed(1).replace(/\.0$/, "");
	return `${thousands}k words`;
}

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
		// Shared header chrome with the review panel (logo + title + controls), so
		// the swatch-book toggle reads as one panel changing modes.
		const header = parent.createDiv({ cls: "editorialist-panel__header" });
		const titleRow = header.createDiv({ cls: "editorialist-panel__title-row" });
		setIcon(titleRow.createSpan({ cls: "editorialist-panel__title-icon" }), EDITORIALIST_ICON_ID);
		titleRow.createEl("h2", { text: "Editorialisms" });

		const modeToggle = titleRow.createEl("button", {
			cls: "editorialist-panel__mode-toggle",
			attr: { "aria-label": "Switch to review", type: "button" },
		});
		setIcon(modeToggle.createSpan({ cls: "editorialist-panel__settings-icon" }), "swatch-book");
		modeToggle.addEventListener("click", () => {
			void this.plugin.togglePanelMode(this.leaf);
		});

		const settingsButton = titleRow.createEl("button", {
			cls: "editorialist-panel__settings-button",
			attr: { "aria-label": "Open Editorialist settings", type: "button" },
		});
		setIcon(settingsButton.createSpan({ cls: "editorialist-panel__settings-icon" }), "settings");
		settingsButton.addEventListener("click", () => {
			this.plugin.openSettings();
		});

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
			text: `Paste an AI reply containing an editorialism file into the review launcher and Editorialist saves it here automatically. You can also create a markdown file under ${path} by hand with frontmatter type: editorialism.`,
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
				"aria-label": "Open source Markdown",
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

		this.renderEstimateCard(detail, editorialism);

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

	// Compact revision-effort estimate for the open directives in this
	// editorialism — authoring time + schedule impact at the author's daily pace.
	private renderEstimateCard(parent: HTMLElement, editorialism: Editorialism): void {
		const estimate = this.plugin.estimateEditorialism(editorialism);
		if (estimate.actionableItems === 0 || estimate.totalMinutes === 0) {
			return;
		}

		const card = parent.createDiv({ cls: "editorialist-editorialism-panel__estimate" });
		const head = card.createDiv({ cls: "editorialist-editorialism-panel__estimate-head" });
		setIcon(head.createSpan({ cls: "editorialist-editorialism-panel__estimate-icon" }), "clock");
		head.createSpan({
			cls: "editorialist-editorialism-panel__estimate-total",
			text: `~${formatEffortDuration(estimate.totalMinutes)} of revision`,
		});
		if (estimate.sessions > 0) {
			const hours = this.plugin.getEffortDailyWritingHours();
			head.createSpan({
				cls: "editorialist-editorialism-panel__estimate-sessions",
				text: `≈ ${estimate.sessions} session${estimate.sessions === 1 ? "" : "s"} at ${hours}h/day`,
			});
		}

		const parts: string[] = [];
		if (estimate.newScenes > 0) {
			parts.push(`${estimate.newScenes} new scene${estimate.newScenes === 1 ? "" : "s"} (~${formatWords(estimate.newWords)})`);
		}
		if (estimate.directiveItems > 0) {
			parts.push(`${estimate.directiveItems} directive${estimate.directiveItems === 1 ? "" : "s"}`);
		}
		if (parts.length > 0) {
			card.createDiv({
				cls: "editorialist-editorialism-panel__estimate-breakdown",
				text: parts.join(" · "),
			});
		}

		card.createDiv({
			cls: "editorialist-editorialism-panel__estimate-note",
			text: "Estimate — drafting rate and scene size are configurable in settings.",
		});
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
		// Fill extents per scope kind are defined in styles.css via the
		// scope-chip--{kind} modifier; unknown kinds fall back to a zero-width fill.
		bar.createSpan({ cls: "editorialist-editorialism-panel__scope-bar-fill" });
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
