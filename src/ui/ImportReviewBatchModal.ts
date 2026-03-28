import { ButtonComponent, Modal, TextAreaComponent, type App } from "obsidian";
import type { ParsedReviewDocument } from "../models/ReviewSuggestion";
import type { ReviewImportBatch } from "../models/ReviewImport";

export interface ImportReviewBatchModalOptions {
	onImport: (batch: ReviewImportBatch, startReview: boolean) => Promise<void>;
	onParse: (rawText: string) => ParsedReviewDocument;
	onResolve: (rawText: string) => Promise<ReviewImportBatch>;
}

export class ImportReviewBatchModal extends Modal {
	private batch: ReviewImportBatch | null = null;
	private parsed: ParsedReviewDocument | null = null;
	private rawText = "";

	constructor(app: App, private readonly options: ImportReviewBatchModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("editorialist-import-modal");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
		this.modalEl.removeClass("editorialist-import-modal");
	}

	private render(): void {
		this.contentEl.empty();
		const shell = this.contentEl.createDiv({ cls: "editorialist-import-modal__content" });

		shell.createEl("h2", {
			cls: "editorialist-import-modal__title",
			text: "Import editorial review batch",
		});
		shell.createDiv({
			cls: "editorialist-import-modal__description",
			text: "Paste one full editorialist-review batch, resolve scenes, verify matches, and route per-note blocks automatically.",
		});

		const inputContainer = shell.createDiv({ cls: "editorialist-import-modal__input" });
		const textArea = new TextAreaComponent(inputContainer);
		textArea.inputEl.addClass("editorialist-import-modal__textarea");
		textArea.setPlaceholder("Paste a full editorialist-review batch here");
		textArea.setValue(this.rawText);
		textArea.onChange((value) => {
			this.rawText = value;
		});

		const actions = shell.createDiv({ cls: "editorialist-import-modal__actions" });
		this.buildButton(actions, "Parse batch", async () => {
			this.parsed = this.options.onParse(this.rawText);
			this.batch = null;
			this.render();
		});
		this.buildButton(actions, "Resolve scenes", async () => {
			this.batch = await this.options.onResolve(this.rawText);
			this.parsed = this.options.onParse(this.rawText);
			this.render();
		});
		this.buildButton(
			actions,
			"Import to notes",
			async () => {
				if (this.batch) {
					await this.options.onImport(this.batch, false);
					this.close();
				}
			},
			!this.batch || this.batch.groups.every((group) => !group.isReady),
		);
		this.buildButton(
			actions,
			"Import and start review",
			async () => {
				if (this.batch) {
					await this.options.onImport(this.batch, true);
					this.close();
				}
			},
			!this.batch || this.batch.groups.every((group) => !group.isReady),
		);
		this.buildButton(actions, "Cancel", async () => {
			this.close();
		});

		this.renderSummary(shell);
		this.renderResults(shell);
	}

	private renderSummary(parent: HTMLElement): void {
		const summary = parent.createDiv({ cls: "editorialist-import-modal__summary" });

		if (this.batch) {
			summary.createDiv({
				text: `${this.batch.summary.totalSuggestions} suggestions • ${this.batch.summary.totalResolvedScenes} resolved scenes • ${this.batch.summary.totalUnresolvedScenes} unresolved scenes`,
			});
			summary.createDiv({
				text: `${this.batch.summary.totalExactMatches} exact • ${this.batch.summary.totalAdvisoryOnly} advisory • ${this.batch.summary.totalUnresolvedMatches} unresolved or multiple`,
			});
			return;
		}

		if (this.parsed) {
			summary.createDiv({
				text: `${this.parsed.suggestions.length} suggestions parsed across ${this.parsed.blockCount} block${this.parsed.blockCount === 1 ? "" : "s"}.`,
			});
			return;
		}

		summary.createDiv({
			text: "Paste a review batch to begin.",
		});
	}

	private renderResults(parent: HTMLElement): void {
		if (!this.batch) {
			return;
		}

		const list = parent.createDiv({ cls: "editorialist-import-modal__list" });
		for (const group of this.batch.groups) {
			const card = list.createDiv({ cls: "editorialist-import-modal__group" });
			card.createDiv({
				cls: "editorialist-import-modal__group-title",
				text: `${group.sceneId ?? "No scene"} → ${group.fileName}`,
			});
			card.createDiv({
				cls: "editorialist-import-modal__group-meta",
				text: `${group.suggestions.length} suggestions • ${group.exactCount} exact • ${group.advisoryCount} advisory • ${group.unresolvedCount} unresolved`,
			});
			card.createDiv({
				cls: "editorialist-import-modal__group-path",
				text: group.filePath,
			});

			for (const result of group.suggestions) {
				card.createDiv({
					cls: "editorialist-import-modal__item",
					text: `${result.suggestion.operation} • ${this.toSentenceCase(result.routeStatus)} • ${this.toSentenceCase(result.verificationStatus)}: ${result.verificationReason}`,
				});
			}
		}

		const unresolved = this.batch.results.filter((result) => !result.resolvedPath);
		if (unresolved.length > 0) {
			const unresolvedCard = list.createDiv({ cls: "editorialist-import-modal__group" });
			unresolvedCard.createDiv({
				cls: "editorialist-import-modal__group-title",
				text: "Unresolved scenes",
			});
			for (const result of unresolved) {
				unresolvedCard.createDiv({
					cls: "editorialist-import-modal__item",
					text: `${result.suggestion.routing?.sceneId ?? result.suggestion.id} • ${result.routeReason}`,
				});
			}
		}
	}

	private buildButton(parent: HTMLElement, label: string, onClick: () => Promise<void>, disabled = false): void {
		const button = new ButtonComponent(parent).setButtonText(label);
		button.setDisabled(disabled);
		button.onClick(() => {
			void onClick();
		});
		button.buttonEl.addClass("editorialist-import-modal__button");
	}

	private toSentenceCase(value: string): string {
		return value.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
	}
}
