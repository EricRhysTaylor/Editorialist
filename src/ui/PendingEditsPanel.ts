import { ItemView, TFile, debounce, setIcon, type WorkspaceLeaf } from "obsidian";
import type EditorialistPlugin from "../main";
import { EDITORIALIST_ICON_ID } from "./EditorialistLogoIcon";
import type { PendingEditsSummary } from "../orchestrators/PendingEditsCoordinator";

export const PENDING_EDITS_PANEL_VIEW_TYPE = "editorialist-pending-edits-panel";

// Standalone hub for the cross-book pending-edits queue: an aggregate summary,
// a browsable per-scene list, and launchers into the review sweep. A peer mode
// of the review and editorialism views, swapped in the same leaf.
export class PendingEditsPanel extends ItemView {
	private summary: PendingEditsSummary | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: EditorialistPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return PENDING_EDITS_PANEL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Pending edits";
	}

	getIcon(): string {
		return EDITORIALIST_ICON_ID;
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("editorialist-pending-panel");

		const refreshDebounced = debounce(() => void this.refresh(), 600);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					refreshDebounced();
				}
			}),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf) {
					void this.refresh();
				}
			}),
		);

		await this.refresh();
	}

	async refresh(): Promise<void> {
		await this.plugin.refreshPendingEditsSummary({ force: true });
		this.summary = this.plugin.getPendingEditsSummary();
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		const shell = this.contentEl.createDiv({ cls: "editorialist-pending-panel__shell" });
		this.renderHeader(shell);

		const summary = this.summary;
		if (!summary || summary.segmentCount <= 0) {
			this.renderEmpty(shell);
			return;
		}
		this.renderSummary(shell, summary);
		this.renderSceneList(shell, summary);
	}

	private renderHeader(parent: HTMLElement): void {
		const header = parent.createDiv({ cls: "editorialist-panel__header" });
		const titleRow = header.createDiv({ cls: "editorialist-panel__title-row" });
		setIcon(titleRow.createSpan({ cls: "editorialist-panel__title-icon" }), EDITORIALIST_ICON_ID);
		titleRow.createEl("h2", { text: "Pending edits" });

		const modeToggle = titleRow.createEl("button", {
			cls: "editorialist-panel__mode-toggle",
			attr: { "aria-label": "Switch panel mode", type: "button" },
		});
		setIcon(modeToggle.createSpan({ cls: "editorialist-panel__settings-icon" }), "swatch-book");
		modeToggle.addEventListener("click", (event) => {
			this.plugin.showPanelModeMenu(event, PENDING_EDITS_PANEL_VIEW_TYPE);
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

	private renderEmpty(parent: HTMLElement): void {
		const empty = parent.createDiv({ cls: "editorialist-pending-panel__empty" });
		empty.createDiv({ cls: "editorialist-pending-panel__empty-title", text: "No pending edits" });
		empty.createDiv({
			cls: "editorialist-pending-panel__empty-copy",
			text: "Accepted edits and author queries waiting to be applied across the active book appear here, grouped by scene.",
		});
	}

	private renderSummary(parent: HTMLElement, summary: PendingEditsSummary): void {
		const card = parent.createDiv({ cls: "editorialist-pending-panel__summary" });
		const itemNoun = summary.segmentCount === 1 ? "item" : "items";
		const sceneNoun = summary.sceneCount === 1 ? "scene" : "scenes";
		card.createDiv({
			cls: "editorialist-pending-panel__summary-total",
			text: `${summary.segmentCount} pending ${itemNoun} across ${summary.sceneCount} ${sceneNoun}`,
		});

		const button = card.createEl("button", {
			cls: "editorialist-pending-panel__review-all",
			attr: { type: "button" },
		});
		setIcon(button.createSpan({ cls: "editorialist-pending-panel__review-all-icon" }), "play");
		button.createSpan({ text: "Review all pending edits" });
		button.addEventListener("click", () => {
			void this.plugin.startPendingEditsReview();
		});
	}

	private renderSceneList(parent: HTMLElement, summary: PendingEditsSummary): void {
		const list = parent.createDiv({ cls: "editorialist-pending-panel__list" });
		for (const scene of summary.scenes) {
			const row = list.createDiv({
				cls: "editorialist-pending-panel__row",
				attr: { "aria-label": `Review pending edits in ${scene.title}` },
			});
			const head = row.createDiv({ cls: "editorialist-pending-panel__row-head" });
			head.createDiv({ cls: "editorialist-pending-panel__row-title", text: scene.title });
			head.createSpan({ cls: "editorialist-pending-panel__row-count", text: `${scene.count}` });
			if (scene.firstExcerpt) {
				row.createDiv({ cls: "editorialist-pending-panel__row-excerpt", text: scene.firstExcerpt });
			}
			const scenePath = scene.scenePath;
			row.addEventListener("click", () => {
				void this.plugin.startPendingEditsReviewForScene(scenePath);
			});
		}
	}
}
