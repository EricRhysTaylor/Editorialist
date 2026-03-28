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
	onResetReviewSession: () => void;
	onStartReviewInCurrentNote: () => Promise<void>;
}

type ClipboardState = "checking" | "ready" | "empty";
type DetectionTone = "danger" | "muted" | "success";
type ModalState = "checking" | "clipboard" | "current-note" | "empty";

interface DetectionItem {
	description: string;
	icon: string;
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
		this.renderWorkflow(shell);
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

		const status = text.createDiv({ cls: "editorialist-control-modal__header-status" });
		status.createDiv({
			cls: `editorialist-control-modal__status-line editorialist-control-modal__status-line--${this.getClipboardTone()}`,
			text: this.getClipboardStatusText(),
		});
		status.createDiv({
			cls: "editorialist-control-modal__next-step",
			text: this.getNextStepText(),
		});
	}

	private renderWorkflow(parent: HTMLElement): void {
		const workflow = parent.createDiv({ cls: "editorialist-control-modal__workflow" });
		workflow.createDiv({
			cls: "editorialist-control-modal__workflow-title",
			text: "How it works",
		});

		const steps = workflow.createEl("ol", { cls: "editorialist-control-modal__workflow-list" });
		steps.createEl("li", { text: "Give the AI chatbot the proper formatting guide" });
		steps.createEl("li", { text: "Copy the AI edits in Editorialist format" });
		const stepThree = steps.createEl("li", { text: "Open Editorialist begin (this modal)" });
		if (this.options.currentNoteHasReviewBlock) {
			stepThree.addClass("editorialist-control-modal__workflow-step--active");
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
			text: "Clipboard review batch validated",
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-copy",
			text: this.describeBatch(clipboardBatch.batch),
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-next",
			text: this.getNextStepText(),
		});

		this.renderDetectionGrid(card, clipboardBatch.batch);
		this.renderActionDivider(card);

		const actions = card.createDiv({ cls: "editorialist-control-modal__actions" });
		this.buildButton(actions, "Import to active note", async () => {
			await this.options.onImportRawToActiveNote(clipboardBatch.rawText, true);
			this.close();
		}, {
			cta: this.isLocalNoteBatch(clipboardBatch.batch),
		});
		this.buildButton(
			actions,
			"Import and start review",
			async () => {
				await this.options.onImportBatch(clipboardBatch.batch, true);
				this.close();
			},
			{
				cta: !this.isLocalNoteBatch(clipboardBatch.batch),
				disabled: !this.hasImportReadyGroup(clipboardBatch.batch),
			},
		);
		this.buildButton(
			actions,
			"Import to matching scenes",
			async () => {
				await this.options.onImportBatch(clipboardBatch.batch, false);
				this.close();
			},
			{
				disabled: !this.hasImportReadyGroup(clipboardBatch.batch),
			},
		);
		this.buildButton(actions, this.showAssignments ? "Hide assignments" : "Review assignments", async () => {
			this.showAssignments = !this.showAssignments;
			this.manualBatch = clipboardBatch.batch;
			this.render();
		});
		this.buildButton(actions, this.showManualPaste ? "Hide manual paste" : "Paste manually", async () => {
			this.showManualPaste = !this.showManualPaste;
			if (this.showManualPaste && !this.manualText.trim()) {
				this.manualText = clipboardBatch.rawText;
			}
			this.render();
		});
	}

	private renderCurrentNoteState(parent: HTMLElement): void {
		const card = parent.createDiv({ cls: "editorialist-control-modal__card" });
		card.createDiv({
			cls: "editorialist-control-modal__card-title",
			text: "Review block found in current note",
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-copy",
			text: this.options.activeNoteLabel
				? `Ready to start review in ${this.options.activeNoteLabel}.`
				: "Ready to start review in the active note.",
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-next",
			text: this.getNextStepText(),
		});

		this.renderDetectionGrid(card);
		this.renderActionDivider(card);

		const actions = card.createDiv({ cls: "editorialist-control-modal__actions" });
		this.buildButton(
			actions,
			"Start review in this note",
			async () => {
				await this.options.onStartReviewInCurrentNote();
				this.close();
			},
			{ cta: true },
		);
		this.buildButton(actions, "Open review panel", async () => {
			await this.options.onOpenReviewPanel();
			this.close();
		});
		this.buildButton(actions, "Reset review session", async () => {
			this.options.onResetReviewSession();
			this.close();
		});
		this.buildButton(actions, this.showManualPaste ? "Hide manual paste" : "Paste review batch manually", async () => {
			this.showManualPaste = !this.showManualPaste;
			this.render();
		});
	}

	private renderEmptyState(parent: HTMLElement): void {
		const card = parent.createDiv({ cls: "editorialist-control-modal__card" });
		card.createDiv({
			cls: "editorialist-control-modal__card-title",
			text: "No review content detected",
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-copy",
			text: "Copy a review template or paste a full review batch to begin.",
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-next",
			text: this.getNextStepText(),
		});

		this.renderDetectionGrid(card);
		this.renderActionDivider(card);

		const actions = card.createDiv({ cls: "editorialist-control-modal__actions" });
		this.buildButton(
			actions,
			"Copy review template",
			async () => {
				await this.options.onCopyTemplate();
			},
			{ cta: true, icon: "copy" },
		);
		this.buildButton(actions, this.showManualPaste ? "Hide manual paste" : "Paste review batch manually", async () => {
			this.showManualPaste = !this.showManualPaste;
			this.render();
		});
	}

	private renderManualPaste(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "editorialist-control-modal__manual" });
		section.createDiv({
			cls: "editorialist-control-modal__section-title",
			text: "Paste review batch",
		});
		section.createDiv({
			cls: "editorialist-control-modal__section-copy",
			text: "Paste a full Editorialist review batch and continue with the same import flow.",
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
		});
		this.buildButton(actions, "Import to active note", async () => {
			if (!this.manualText.trim()) {
				return;
			}

			await this.options.onImportRawToActiveNote(this.manualText, true);
			this.close();
		}, {
			disabled: !this.manualText.trim(),
		});
		this.buildButton(actions, "Clear input", async () => {
			this.manualText = "";
			this.manualBatch = null;
			this.showAssignments = false;
			this.render();
		}, {
			disabled: !this.manualText.trim(),
		});
	}

	private renderAssignments(parent: HTMLElement, batch: ReviewImportBatch): void {
		const summary = parent.createDiv({ cls: "editorialist-control-modal__summary" });
		summary.createDiv({
			text: `${batch.summary.totalSuggestions} suggestions • ${batch.summary.totalResolvedScenes} resolved scenes • ${batch.summary.totalUnresolvedScenes} unresolved scenes`,
		});
		summary.createDiv({
			text: `${batch.summary.totalExactMatches} exact • ${batch.summary.totalAdvisoryOnly} advisory • ${batch.summary.totalUnresolvedMatches} unresolved or multiple`,
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
				text: `${group.suggestions.length} suggestions • ${group.exactCount} exact • ${group.advisoryCount} advisory • ${group.unresolvedCount} unresolved`,
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

		const toggle = new ButtonComponent(header)
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
				cls: `editorialist-control-modal__detection editorialist-control-modal__detection--${item.tone}`,
			});
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
		}
	}

	private renderActionDivider(parent: HTMLElement): void {
		parent.createEl("hr", { cls: "editorialist-control-modal__divider" });
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

	private describeBatch(batch: ReviewImportBatch): string {
		const directCount = Math.max(0, batch.summary.totalSuggestions - batch.summary.totalAdvisoryOnly);
		const targetLabel = this.isLocalNoteBatch(batch)
			? "local note"
			: `${batch.groups.length} scene${batch.groups.length === 1 ? "" : "s"}`;
		return `${batch.summary.totalSuggestions} suggestions for ${targetLabel} • ${directCount} direct • ${batch.summary.totalAdvisoryOnly} advisory`;
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
			return "Clipboard: validated Editorialist review content detected.";
		}

		if (this.clipboardState === "empty") {
			return "Clipboard: no recognized Editorialist review content.";
		}

		return "Clipboard: checking for Editorialist review content.";
	}

	private getNextStepText(): string {
		if (this.clipboardBatch) {
			if (this.isLocalNoteBatch(this.clipboardBatch.batch)) {
				return "Next: click Import to active note to begin the edit sweep in this note.";
			}

			return "Next: review assignments or import to matching scenes, then begin the review sweep.";
		}

		if (this.options.currentNoteHasReviewBlock) {
			return "Next: click Start review in this note to begin the edit sweep.";
		}

		return "Next: copy the review template, then paste AI output here or into the clipboard.";
	}

	private getDetectionItems(batch?: ReviewImportBatch): DetectionItem[] {
		const localNoteBatch = batch ? this.isLocalNoteBatch(batch) : false;
		const clipboardDescription =
			this.clipboardState === "ready"
				? batch
					? `${batch.summary.totalSuggestions} suggestions validated`
					: "Validated review content found"
				: this.clipboardState === "empty"
					? "No recognized review content"
					: "Checking clipboard";
		const targetDescription = batch
			? localNoteBatch
				? "Local note target"
				: `${batch.groups.length} scene${batch.groups.length === 1 ? "" : "s"} detected`
			: this.options.currentNoteHasReviewBlock
				? "Ready in current note"
				: "Import first to begin";

		return [
			{
				icon: "clipboard",
				label: "Clipboard",
				description: clipboardDescription,
				tone: this.getClipboardTone(),
			},
			{
				icon: "file-text",
				label: "Current note",
				description: this.options.currentNoteHasReviewBlock
					? "Review block found"
					: "No review block found",
				tone: this.options.currentNoteHasReviewBlock ? "success" : "muted",
			},
			{
				icon: "play",
				label: "Begin sweep",
				description: targetDescription,
				tone: this.options.currentNoteHasReviewBlock || localNoteBatch ? "success" : "muted",
			},
		];
	}

	private buildButton(
		parent: HTMLElement,
		label: string,
		onClick: () => Promise<void>,
		options?: {
			cta?: boolean;
			disabled?: boolean;
			icon?: string;
		},
	): void {
		const button = new ButtonComponent(parent).setButtonText(label);
		button.setDisabled(Boolean(options?.disabled || this.isWorking));
		if (options?.cta) {
			button.setCta();
		}
		button.buttonEl.addClass("editorialist-control-modal__button");
		if (options?.icon) {
			const icon = button.buttonEl.createSpan({ cls: "editorialist-control-modal__button-icon" });
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
