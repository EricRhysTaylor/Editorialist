import { ButtonComponent, Modal, Notice, TextAreaComponent, setIcon, type App } from "obsidian";
import { getReviewBlockFenceLabel } from "../core/ReviewBlockFormat";
import type { ReviewImportBatch } from "../models/ReviewImport";
import { REVIEW_TEMPLATE_BLOCK } from "./PrepareReviewFormatModal";

export interface ClipboardReviewBatch {
	batch: ReviewImportBatch;
	rawText: string;
}

export interface EditorialistModalOptions {
	activeNoteLabel?: string;
	currentNoteHasReviewBlock: boolean;
	onCopyTemplate: () => Promise<void>;
	onImportBatch: (batch: ReviewImportBatch, startReview: boolean) => Promise<void>;
	onImportRawToActiveNote: (rawText: string, startReview: boolean) => Promise<void>;
	onInspectBatch: (rawText: string) => Promise<ReviewImportBatch>;
	onLoadClipboardBatch: () => Promise<ClipboardReviewBatch | null>;
	onOpenReviewPanel: () => Promise<void>;
	onStartReviewInCurrentNote: () => Promise<void>;
}

type ClipboardState = "checking" | "ready" | "empty";
type DetectionTone = "danger" | "muted" | "success";
type ModalState = "checking" | "clipboard" | "current-note" | "empty";

interface DetectionItem {
	actionLabel?: string;
	actionHint?: string;
	description: string;
	disabled?: boolean;
	emphasized?: boolean;
	icon: string;
	id: "clipboard" | "current-note" | "template";
	label: string;
	tone: DetectionTone;
}

export class EditorialistModal extends Modal {
	private clipboardBatch: ClipboardReviewBatch | null = null;
	private clipboardState: ClipboardState = "checking";
	private isWorking = false;
	private manualBatch: ReviewImportBatch | null = null;
	private manualText = "";
	private showAssignments = false;
	private showExample = false;
	private showManualPaste = false;

	constructor(app: App, private readonly options: EditorialistModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("editorialist-control-modal");
		void this.detectClipboardBatch();
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
		this.modalEl.removeClass("editorialist-control-modal");
	}

	private async detectClipboardBatch(): Promise<void> {
		this.clipboardState = "checking";
		this.render();

		try {
			this.clipboardBatch = await this.options.onLoadClipboardBatch();
			this.clipboardState = this.clipboardBatch ? "ready" : "empty";
		} catch {
			this.clipboardBatch = null;
			this.clipboardState = "empty";
		}

		if (!this.clipboardBatch && !this.options.currentNoteHasReviewBlock) {
			this.showManualPaste = true;
		}

		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		const shell = this.contentEl.createDiv({ cls: "editorialist-control-modal__content" });

		this.renderHeader(shell);
		this.renderPrimaryState(shell);

		if (this.showManualPaste) {
			this.renderManualPaste(shell);
		}

		const batchToPreview = this.getPreviewBatch();
		if (this.showAssignments && batchToPreview) {
			this.renderAssignments(shell, batchToPreview);
		}

		this.renderExample(shell);
	}

	private renderHeader(parent: HTMLElement): void {
		const header = parent.createDiv({ cls: "editorialist-control-modal__header" });
		const icon = header.createSpan({ cls: "editorialist-control-modal__icon" });
		setIcon(icon, "file-text");
		icon.addClass(`editorialist-control-modal__icon--${this.getHeaderIconTone()}`);

		const text = header.createDiv({ cls: "editorialist-control-modal__header-text" });
		text.createDiv({
			cls: "editorialist-control-modal__title",
			text: "Editorialist",
		});
		text.createDiv({
			cls: "editorialist-control-modal__subtitle",
			text: "Import, prepare, and start editorial review",
		});

		const statusText = this.getClipboardStatusText();
		if (statusText) {
			const status = text.createDiv({ cls: "editorialist-control-modal__header-status" });
			status.createDiv({
				cls: "editorialist-control-modal__status-line editorialist-control-modal__status-line--muted",
				text: statusText,
			});
		}
	}

	private renderPrimaryState(parent: HTMLElement): void {
		if (this.getModalState() === "checking") {
			this.renderMessageCard(
				parent,
				"Checking clipboard and current note for review content.",
				`Looking for an ${getReviewBlockFenceLabel()} in the clipboard or current note.`,
			);
			return;
		}

		if (this.clipboardBatch) {
			this.renderClipboardState(parent, this.clipboardBatch);
			return;
		}

		if (this.options.currentNoteHasReviewBlock) {
			this.renderCurrentNoteState(parent);
			return;
		}

		this.renderEmptyState(parent);
	}

	private renderClipboardState(parent: HTMLElement, clipboardBatch: ClipboardReviewBatch): void {
		const card = parent.createDiv({ cls: "editorialist-control-modal__card" });
		card.createDiv({
			cls: "editorialist-control-modal__card-title",
			text: "Clipboard ready",
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-copy",
			text: "Review batch detected.",
		});

		this.renderDetectionGrid(card, clipboardBatch.batch);
		this.renderSecondaryActions(card, [
			{
				icon: "clipboard",
				label: this.showManualPaste ? "Hide manual paste" : "Paste review batch manually",
				onClick: async () => {
					this.showManualPaste = !this.showManualPaste;
					if (this.showManualPaste && !this.manualText.trim()) {
						this.manualText = clipboardBatch.rawText;
					}
					this.render();
				},
			},
		]);
	}

	private renderCurrentNoteState(parent: HTMLElement): void {
		const card = parent.createDiv({ cls: "editorialist-control-modal__card" });
		card.createDiv({
			cls: "editorialist-control-modal__card-title",
			text: "Current note ready",
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-copy",
			text: this.options.activeNoteLabel ?? "Review block found",
		});

		this.renderDetectionGrid(card);
		this.renderSecondaryActions(card, [
			{
				icon: "clipboard",
				label: this.showManualPaste ? "Hide manual paste" : "Paste review batch manually",
				onClick: async () => {
					this.showManualPaste = !this.showManualPaste;
					this.render();
				},
			},
			{
				icon: "navigation",
				label: "Open review panel",
				onClick: async () => {
					await this.options.onOpenReviewPanel();
					this.close();
				},
			},
		]);
	}

	private renderEmptyState(parent: HTMLElement): void {
		const card = parent.createDiv({ cls: "editorialist-control-modal__card" });
		card.createDiv({
			cls: "editorialist-control-modal__card-title",
			text: "Get started",
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-copy",
			text: "Copy the template or paste a review batch.",
		});

		this.renderDetectionGrid(card);
		this.renderSecondaryActions(card, [
			{
				icon: "clipboard",
				label: this.showManualPaste ? "Hide manual paste" : "Paste review batch manually",
				onClick: async () => {
					this.showManualPaste = !this.showManualPaste;
					this.render();
				},
			},
		]);
	}

	private renderManualPaste(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "editorialist-control-modal__manual" });
		section.createDiv({
			cls: "editorialist-control-modal__section-title",
			text: "Paste review batch",
		});
		section.createDiv({
			cls: "editorialist-control-modal__section-copy",
			text: "Paste a full Editorialist review batch.",
		});

		const inputContainer = section.createDiv({ cls: "editorialist-control-modal__input" });
		const textArea = new TextAreaComponent(inputContainer);
		textArea.inputEl.addClass("editorialist-control-modal__textarea");
		textArea.setPlaceholder("Paste a full editorialist-review batch here");
		textArea.setValue(this.manualText);
		textArea.onChange((value) => {
			this.manualText = value;
			this.manualBatch = null;
		});

		const actions = section.createDiv({ cls: "editorialist-control-modal__actions" });
		this.buildButton(actions, "Review assignments", async () => {
			const batch = await this.ensureManualBatch();
			if (!batch) {
				return;
			}

			this.manualBatch = batch;
			this.showAssignments = true;
			this.render();
		}, {
			disabled: !this.manualText.trim(),
			icon: "navigation",
		});
		this.buildButton(actions, "Import to matching scenes", async () => {
			const batch = await this.ensureManualBatch();
			if (!batch) {
				return;
			}

			await this.options.onImportBatch(batch, false);
			this.close();
		}, {
			disabled: !this.manualText.trim(),
			icon: "download",
		});
		this.buildButton(actions, "Import and start review", async () => {
			const batch = await this.ensureManualBatch();
			if (!batch) {
				return;
			}

			await this.options.onImportBatch(batch, true);
			this.close();
		}, {
			disabled: !this.manualText.trim(),
			icon: "download",
		});
		this.buildButton(actions, "Import to active note", async () => {
			if (!this.manualText.trim()) {
				return;
			}

			await this.options.onImportRawToActiveNote(this.manualText, true);
			this.close();
		}, {
			disabled: !this.manualText.trim(),
			icon: "download",
		});
		this.buildButton(actions, "Clear input", async () => {
			this.manualText = "";
			this.manualBatch = null;
			this.showAssignments = false;
			this.render();
		}, {
			disabled: !this.manualText.trim(),
			icon: "x",
		});
	}

	private renderAssignments(parent: HTMLElement, batch: ReviewImportBatch): void {
		const summary = parent.createDiv({ cls: "editorialist-control-modal__summary" });
		summary.createDiv({
			text: `${batch.summary.totalMatchedScenes} matched scenes • ${batch.summary.totalSuggestions} entries • ${batch.summary.totalUnresolvedScenes} unresolved scenes • ${batch.summary.totalMismatches} mismatches`,
		});
		summary.createDiv({
			text: `${batch.summary.totalResolvedScenes} ready • ${batch.summary.totalExactMatches} exact • ${batch.summary.totalAdvisoryOnly} advisory • ${batch.summary.totalUnresolvedMatches} unresolved or multiple`,
		});

		const list = parent.createDiv({ cls: "editorialist-control-modal__list" });
		for (const group of batch.groups) {
			const card = list.createDiv({ cls: "editorialist-control-modal__group" });
			card.createDiv({
				cls: "editorialist-control-modal__group-title",
				text: `${group.sceneId ?? "No scene"} → ${group.fileName}`,
			});
			card.createDiv({
				cls: "editorialist-control-modal__group-meta",
				text: `${group.suggestions.length} entries • ${group.exactCount} exact • ${group.advisoryCount} advisory • ${group.mismatchCount} mismatched • ${group.unresolvedCount} unresolved`,
			});
			card.createDiv({
				cls: "editorialist-control-modal__group-path",
				text: group.filePath,
			});

			for (const result of group.suggestions) {
				card.createDiv({
					cls: "editorialist-control-modal__item",
					text: `${this.toSentenceCase(result.suggestion.operation)} • ${this.toSentenceCase(result.routeStatus)} • ${this.toSentenceCase(result.verificationStatus)}: ${result.verificationReason}`,
				});
			}
		}

		const unresolved = batch.results.filter((result) => !result.resolvedPath);
		if (unresolved.length === 0) {
			return;
		}

		const unresolvedCard = list.createDiv({ cls: "editorialist-control-modal__group" });
		unresolvedCard.createDiv({
			cls: "editorialist-control-modal__group-title",
			text: "Unresolved scenes",
		});
		for (const result of unresolved) {
			unresolvedCard.createDiv({
				cls: "editorialist-control-modal__item",
				text: `${result.suggestion.routing?.sceneId ?? result.suggestion.id} • ${result.routeReason}`,
			});
		}
	}

	private renderExample(parent: HTMLElement): void {
		const example = parent.createDiv({ cls: "editorialist-control-modal__example" });
		const header = example.createDiv({ cls: "editorialist-control-modal__example-header" });
		header.createDiv({
			cls: "editorialist-control-modal__section-title",
			text: "Example format",
		});

		const actions = header.createDiv({ cls: "editorialist-control-modal__example-actions" });
		const copy = new ButtonComponent(actions)
			.setButtonText("Copy template")
			.onClick(() => {
				void this.runAction(async () => {
					await this.options.onCopyTemplate();
				});
			});
		copy.buttonEl.addClass("editorialist-control-modal__example-button");
		setIcon(copy.buttonEl.createSpan({ cls: "editorialist-control-modal__button-icon" }), "copy");

		const toggle = new ButtonComponent(actions)
			.setIcon(this.showExample ? "chevron-up" : "chevron-down")
			.setTooltip(this.showExample ? "Contract example format" : "Expand example format")
			.onClick(() => {
				this.showExample = !this.showExample;
				this.render();
			});
		toggle.buttonEl.addClass("editorialist-control-modal__example-toggle");

		if (!this.showExample) {
			return;
		}

		example.createEl("pre", {
			cls: "editorialist-control-modal__example-block",
			text: REVIEW_TEMPLATE_BLOCK,
		});
		example.createDiv({
			cls: "editorialist-control-modal__footer",
			text: "Return only this fenced block. No extra text.",
		});
	}

	private renderDetectionGrid(parent: HTMLElement, batch?: ReviewImportBatch): void {
		const grid = parent.createDiv({ cls: "editorialist-control-modal__detection-grid" });
		for (const item of this.getDetectionItems(batch)) {
			const card = grid.createDiv({
				cls: `editorialist-control-modal__detection editorialist-control-modal__detection--${item.tone}${item.emphasized ? " is-emphasized" : ""}${item.disabled ? " is-disabled" : ""}`,
			});
			card.setAttribute("role", "button");
			card.tabIndex = item.disabled || this.isWorking ? -1 : 0;
			card.setAttribute("aria-label", item.actionLabel ?? item.label);
			if (!item.disabled && !this.isWorking) {
				card.addEventListener("click", () => {
					void this.runAction(() => this.handleDetectionAction(item.id));
				});
				card.addEventListener("keydown", (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						void this.runAction(() => this.handleDetectionAction(item.id));
					}
				});
			}
			const icon = card.createDiv({ cls: "editorialist-control-modal__detection-icon" });
			setIcon(icon, item.icon);
			card.createDiv({
				cls: "editorialist-control-modal__detection-label",
				text: item.label,
			});
			card.createDiv({
				cls: "editorialist-control-modal__detection-copy",
				text: item.description,
			});
			if (item.actionHint) {
				card.createDiv({
					cls: "editorialist-control-modal__detection-hint",
					text: item.actionHint,
				});
			}
		}
	}

	private renderSecondaryActions(
		parent: HTMLElement,
		actionsConfig: Array<{
			icon: string;
			label: string;
			onClick: () => Promise<void>;
		}>,
	): void {
		if (actionsConfig.length === 0) {
			return;
		}

		parent.createEl("hr", { cls: "editorialist-control-modal__divider" });
		const actions = parent.createDiv({ cls: "editorialist-control-modal__secondary-actions" });
		actionsConfig.forEach((action) => {
			this.buildButton(actions, action.label, action.onClick, {
				icon: action.icon,
				subtle: true,
			});
		});
	}

	private async ensureManualBatch(): Promise<ReviewImportBatch | null> {
		const rawText = this.manualText.trim();
		if (!rawText) {
			return null;
		}

		try {
			const batch = await this.options.onInspectBatch(rawText);
			if (!this.hasDetectedSuggestions(batch)) {
				new Notice(`No Editorialist review content found in the pasted text.`);
				return null;
			}

			this.manualBatch = batch;
			return batch;
		} catch {
			new Notice("Could not inspect the pasted review batch.");
			return null;
		}
	}

	private getPreviewBatch(): ReviewImportBatch | null {
		if (this.showManualPaste && this.manualBatch) {
			return this.manualBatch;
		}

		return this.clipboardBatch?.batch ?? null;
	}

	private hasDetectedSuggestions(batch: ReviewImportBatch): boolean {
		return batch.summary.totalSuggestions > 0;
	}

	private hasImportReadyGroup(batch: ReviewImportBatch): boolean {
		return batch.groups.some((group) => group.isReady);
	}

	private isLocalNoteBatch(batch: ReviewImportBatch): boolean {
		return batch.results.every((result) => {
			const routing = result.suggestion.routing;
			return !routing?.sceneId && !routing?.note && !routing?.path && !routing?.scene;
		});
	}

	private getModalState(): ModalState {
		if (this.clipboardState === "checking") {
			return "checking";
		}

		if (this.clipboardBatch) {
			return "clipboard";
		}

		if (this.options.currentNoteHasReviewBlock) {
			return "current-note";
		}

		return "empty";
	}

	private getClipboardTone(): DetectionTone {
		if (this.clipboardState === "ready") {
			return "success";
		}

		if (this.clipboardState === "empty") {
			return "danger";
		}

		return "muted";
	}

	private getHeaderIconTone(): DetectionTone {
		return this.getClipboardTone();
	}

	private getClipboardStatusText(): string {
		if (this.clipboardState === "ready") {
			return "Clipboard ready";
		}

		if (this.clipboardState === "empty") {
			return "";
		}

		return "Checking clipboard";
	}

	private getDetectionItems(batch?: ReviewImportBatch): DetectionItem[] {
		const clipboardDescription =
			this.clipboardState === "ready"
				? "Review batch detected"
				: this.clipboardState === "empty"
					? "No review content"
					: "Checking clipboard";

		if (this.options.currentNoteHasReviewBlock) {
			return [
				{
					actionLabel: "Start review in current note",
					actionHint: "→ Start review",
					emphasized: true,
					icon: "file-text",
					id: "current-note",
					label: "Current note",
					description: "Review block found",
					tone: "success",
				},
				{
					actionLabel: this.clipboardState === "ready" ? "Import clipboard review batch" : "Paste review batch manually",
					actionHint:
						this.clipboardState === "ready"
							? "→ Import review"
							: "→ Paste review",
					emphasized: false,
					icon: "clipboard",
					id: "clipboard",
					label: "Clipboard",
					description: clipboardDescription,
					tone: this.getClipboardTone(),
				},
			];
		}

		if (this.clipboardBatch || batch) {
			return [
				{
					actionLabel: "Import clipboard review batch",
					actionHint: "→ Import review",
					emphasized: true,
					icon: "clipboard",
					id: "clipboard",
					label: "Clipboard",
					description: "Review batch detected",
					tone: "success",
				},
			];
		}

		return [
			{
				actionLabel: "Copy review template",
				actionHint: "→ Copy template",
				emphasized: true,
				icon: "copy",
				id: "template",
				label: "Copy template",
				description: "Get the review format",
				tone: "success",
			},
			{
				actionLabel: "Paste review batch manually",
				actionHint: "→ Paste review",
				emphasized: false,
				icon: "clipboard",
				id: "clipboard",
				label: "Clipboard",
				description: "No review content",
				tone: "danger",
			},
		];
	}

	private async handleDetectionAction(id: DetectionItem["id"]): Promise<void> {
		if (id === "template") {
			await this.options.onCopyTemplate();
			return;
		}

		if (id === "current-note") {
			if (!this.options.currentNoteHasReviewBlock) {
				return;
			}

			await this.options.onStartReviewInCurrentNote();
			this.close();
			return;
		}

		if (id === "clipboard") {
			if (this.clipboardBatch) {
				if (this.isLocalNoteBatch(this.clipboardBatch.batch)) {
					await this.options.onImportRawToActiveNote(this.clipboardBatch.rawText, true);
				} else {
					await this.options.onImportBatch(this.clipboardBatch.batch, true);
				}
				this.close();
				return;
			}

			this.showManualPaste = true;
			this.render();
			return;
		}
	}

	private buildButton(
		parent: HTMLElement,
		label: string,
		onClick: () => Promise<void>,
		options?: {
			cta?: boolean;
			disabled?: boolean;
			icon?: string;
			subtle?: boolean;
		},
	): void {
		const button = new ButtonComponent(parent).setButtonText(label);
		button.setDisabled(Boolean(options?.disabled || this.isWorking));
		if (options?.cta) {
			button.setCta();
		}
		button.buttonEl.addClass("editorialist-control-modal__button");
		if (options?.subtle) {
			button.buttonEl.addClass("editorialist-control-modal__button--subtle");
		}
		if (options?.icon) {
			const icon = button.buttonEl.createSpan({ cls: "editorialist-control-modal__button-icon" });
			button.buttonEl.prepend(icon);
			setIcon(icon, options.icon);
		}
		button.onClick(() => {
			void this.runAction(onClick);
		});
	}

	private renderMessageCard(parent: HTMLElement, title: string, copy: string): void {
		const card = parent.createDiv({ cls: "editorialist-control-modal__card" });
		card.createDiv({
			cls: "editorialist-control-modal__card-title",
			text: title,
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-copy",
			text: copy,
		});
	}

	private async runAction(action: () => Promise<void>): Promise<void> {
		if (this.isWorking) {
			return;
		}

		this.isWorking = true;
		this.render();

		try {
			await action();
		} finally {
			this.isWorking = false;
			if (this.modalEl.isConnected) {
				this.render();
			}
		}
	}

	private toSentenceCase(value: string): string {
		return value.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
	}
}
