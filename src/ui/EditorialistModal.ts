import { ButtonComponent, Modal, Notice, TextAreaComponent, setIcon, type App } from "obsidian";
import { buildModalFooter, type ModalFooterButtonSpec } from "./primitives/ModalFooter";
import { getReviewBlockFenceLabel } from "../core/ReviewBlockFormat";
import {
	ADVANCED_REVIEW_TEMPLATE_TITLE,
	REVIEW_TEMPLATE_BLOCK,
	SUPPORTED_REVIEW_OPERATION_SUMMARY,
} from "../core/ReviewTemplate";
import type { ReviewImportBatch, ReviewImportSuggestionResult } from "../models/ReviewImport";

export interface ClipboardReviewBatch {
	batch: ReviewImportBatch;
	rawText: string;
}

export interface EditorialistModalOptions {
	activeBookLabel?: string | null;
	activeNoteLabel?: string;
	currentNoteHasReviewBlock: boolean;
	currentNoteStatus?: "ready" | "completed";
	isReviewPanelOpen: boolean;
	nextNoteLabel?: string;
	noteUnitLabel?: "note" | "scene";
	onCopyTemplate: () => Promise<void>;
	// True when the given text carries a Format B editorialism file.
	detectEditorialism: (rawText: string) => boolean;
	// Save the editorialism file embedded in the text; resolves true on success.
	onSaveEditorialism: (rawText: string) => Promise<boolean>;
	onImportBatch: (batch: ReviewImportBatch, startReview: boolean) => Promise<void>;
	onImportRawToActiveNote: (rawText: string, startReview: boolean) => Promise<void>;
	onInspectBatch: (
		rawText: string,
		correctedTargets?: ReadonlyMap<string, string>,
	) => Promise<ReviewImportBatch>;
	onLoadClipboardBatch: () => Promise<ClipboardReviewBatch | null>;
	onOpenReviewPanel: () => Promise<void>;
	onStartReviewInCurrentNote: () => Promise<void>;
	onStartReviewInNextNote: () => Promise<void>;
}

interface ManualImportError {
	headline: string;
	details: string[];
	hint?: string;
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
	id: "active-book" | "clipboard" | "current-note" | "next-note" | "template";
	label: string;
	tone: DetectionTone;
}

export class EditorialistModal extends Modal {
	private clipboardBatch: ClipboardReviewBatch | null = null;
	private clipboardState: ClipboardState = "checking";
	private manualImportError: ManualImportError | null = null;
	private manualValidationState: "idle" | "pending" | "ok" | "error" = "idle";
	private manualValidationToken = 0;
	private manualValidationTimer: number | null = null;
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
		if (this.manualValidationTimer !== null) {
			window.clearTimeout(this.manualValidationTimer);
			this.manualValidationTimer = null;
		}
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
			cls: "editorialist-control-modal__description",
			text: "Import formatted revision notes, continue in this note, or copy formatting instructions for your AI.",
		});
	}

	private renderPrimaryState(parent: HTMLElement): void {
		if (this.getModalState() === "checking") {
			this.renderMessageCard(
				parent,
				"Checking clipboard and current note.",
				`Looking for ${getReviewBlockFenceLabel()} formatted revision notes.`,
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
		this.renderSelectionSummary(card, clipboardBatch.batch);

		this.renderDetectionGrid(card, clipboardBatch.batch);
		this.renderSecondaryActions(card, [
			{
				icon: "clipboard",
				label: this.showManualPaste ? "Hide pasted notes" : "Paste formatted revision notes",
				onClick: async () => {
					this.showManualPaste = !this.showManualPaste;
					if (this.showManualPaste && !this.manualText.trim()) {
						this.manualText = clipboardBatch.rawText;
						this.scheduleManualValidation();
					}
					this.render();
				},
			},
		]);
	}

	private renderCurrentNoteState(parent: HTMLElement): void {
		const card = parent.createDiv({ cls: "editorialist-control-modal__card" });
		this.renderSelectionSummary(card);

		this.renderDetectionGrid(card);
		if (!this.options.isReviewPanelOpen) {
			this.renderSecondaryActions(card, [
				{
					icon: "pen-tool",
					label: "Open revisions side-panel",
					onClick: async () => {
						await this.options.onOpenReviewPanel();
						this.close();
					},
				},
			]);
		}
	}

	private renderEmptyState(parent: HTMLElement): void {
		const card = parent.createDiv({ cls: "editorialist-control-modal__card" });
		this.renderSelectionSummary(card);

		this.renderDetectionGrid(card);
		this.renderSecondaryActions(card, [
			{
				icon: "clipboard",
				label: this.showManualPaste ? "Hide pasted notes" : "Paste formatted revision notes",
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
			text: "Paste formatted revision notes",
		});
		section.createDiv({
			cls: "editorialist-control-modal__section-copy",
			text: "Paste formatted revision notes here.",
		});

		const inputContainer = section.createDiv({ cls: "editorialist-control-modal__input" });
		const textArea = new TextAreaComponent(inputContainer);
		textArea.inputEl.addClass("editorialist-control-modal__textarea");
		textArea.setPlaceholder("Paste formatted revision notes here");
		textArea.setValue(this.manualText);
		textArea.onChange((value) => {
			this.manualText = value;
			this.manualBatch = null;
			this.scheduleManualValidation();
		});

		const corrections =
			this.manualValidationState === "ok" && this.manualBatch
				? this.collectProposedCorrections(this.manualBatch)
				: [];

		if (this.manualImportError) {
			this.renderManualImportError(section, this.manualImportError);
		} else if (corrections.length > 0) {
			this.renderProposedCorrections(section, corrections);
			return;
		} else if (this.manualValidationState === "ok" && this.manualBatch) {
			this.renderManualValidationOk(section, this.manualBatch);
		}

		const hasText = Boolean(this.manualText.trim());
		const importDisabled = !hasText
			|| this.manualValidationState === "pending"
			|| this.manualValidationState === "error";
		const importLabel = this.getImportButtonLabel();

		// Format B detection runs independently of the review-batch (Format A)
		// validation: a paste may carry an editorialism file, a review block, or
		// both, and each gets its own action.
		const hasEditorialism = hasText && this.options.detectEditorialism(this.manualText);
		if (hasEditorialism) {
			const banner = section.createDiv({ cls: "editorialist-control-modal__editorialism-note" });
			const bannerIcon = banner.createSpan({ cls: "editorialist-control-modal__editorialism-note-icon" });
			setIcon(bannerIcon, "list-checks");
			banner.createSpan({
				text: "Editorialism file detected — save it to your Editorialist folder and open the Editorialisms panel.",
			});
		}

		const buttons = [
			this.makeActionButtonSpec({
				text: importLabel,
				cta: true,
				disabled: importDisabled,
				icon: this.manualValidationState === "error" ? "alert-triangle" : "download",
				onClick: async () => {
					const batch = await this.ensureManualBatch();
					if (!batch) {
						return;
					}

					await this.options.onImportBatch(batch, true);
					this.close();
				},
			}),
			this.makeActionButtonSpec({
				text: "Preview destinations",
				disabled: !hasText || this.manualValidationState === "pending",
				icon: "navigation",
				subtle: true,
				onClick: async () => {
					const batch = await this.ensureManualBatch();
					if (!batch) {
						return;
					}

					this.manualBatch = batch;
					this.showAssignments = true;
					this.render();
				},
			}),
		];

		if (hasEditorialism) {
			buttons.push(
				this.makeActionButtonSpec({
					text: "Save editorialism file",
					icon: "list-checks",
					subtle: true,
					onClick: async () => {
						const saved = await this.options.onSaveEditorialism(this.manualText);
						if (saved) {
							this.close();
						}
					},
				}),
			);
		}

		buildModalFooter(section, {
			className: "editorialist-control-modal__actions",
			buttons,
		});
	}

	private getImportButtonLabel(): string {
		switch (this.manualValidationState) {
			case "pending":
				return "Checking paste…";
			case "error":
				return "Can't import — see issues above";
			default:
				return "Import and start review";
		}
	}

	private renderManualValidationOk(parent: HTMLElement, batch: ReviewImportBatch): void {
		const banner = parent.createDiv({ cls: "editorialist-control-modal__validation-ok" });
		const icon = banner.createSpan({ cls: "editorialist-control-modal__validation-ok-icon" });
		setIcon(icon, "check-circle-2");
		const matched = batch.summary.totalMatchedScenes;
		const sceneNoun = matched === 1 ? "scene" : "scenes";
		banner.createSpan({
			cls: "editorialist-control-modal__validation-ok-text",
			text: `${batch.summary.totalSuggestions} suggestion${batch.summary.totalSuggestions === 1 ? "" : "s"} ready · ${matched} matched ${sceneNoun}`,
		});
	}

	private collectProposedCorrections(batch: ReviewImportBatch): ReviewImportSuggestionResult[] {
		return batch.results.filter((result) => Boolean(result.proposedCorrection));
	}

	// When the AI stamped entries with a stale/wrong SceneId, block the normal
	// import path and force an explicit decision: re-target every flagged entry
	// to the scene its text actually lives in, or abort the whole import so the
	// author can fix the source. Never silently apply.
	private renderProposedCorrections(
		parent: HTMLElement,
		corrections: ReviewImportSuggestionResult[],
	): void {
		const panel = parent.createDiv({ cls: "editorialist-control-modal__correction" });
		const header = panel.createDiv({ cls: "editorialist-control-modal__correction-header" });
		const icon = header.createSpan({ cls: "editorialist-control-modal__correction-icon" });
		setIcon(icon, "alert-triangle");
		header.createSpan({
			cls: "editorialist-control-modal__correction-title",
			text: `${corrections.length} entr${corrections.length === 1 ? "y looks" : "ies look"} mis-targeted`,
		});
		panel.createDiv({
			cls: "editorialist-control-modal__correction-copy",
			text: "The declared SceneId points at a scene that does not contain the quoted text, but the text matches exactly one other scene. This usually means the AI reused a stale scene id from the chat thread.",
		});

		for (const result of corrections) {
			const correction = result.proposedCorrection;
			if (!correction) {
				continue;
			}
			const row = panel.createDiv({ cls: "editorialist-control-modal__correction-row" });
			row.createDiv({
				cls: "editorialist-control-modal__correction-op",
				text: this.toSentenceCase(result.suggestion.operation),
			});
			row.createDiv({
				cls: "editorialist-control-modal__correction-move",
				text: `${correction.declaredSceneId ?? correction.declaredNoteTitle} (${correction.declaredNoteTitle}) → ${correction.targetNoteTitle}${correction.targetSceneId ? ` (${correction.targetSceneId})` : ""}`,
			});
		}

		buildModalFooter(panel, {
			className: "editorialist-control-modal__actions",
			buttons: [
				this.makeActionButtonSpec({
					text: `Re-target ${corrections.length} and import`,
					cta: true,
					icon: "wand-2",
					onClick: async () => {
						const overrides = new Map<string, string>();
						for (const result of corrections) {
							if (result.proposedCorrection) {
								overrides.set(result.suggestion.id, result.proposedCorrection.targetPath);
							}
						}
						const rawText = this.manualText.trim();
						if (!rawText) {
							return;
						}
						let corrected: ReviewImportBatch;
						try {
							corrected = await this.options.onInspectBatch(rawText, overrides);
						} catch {
							this.setManualImportError({
								headline: "Could not re-target the entries",
								details: ["Editorialist failed to re-inspect the batch with the corrected scene targets."],
								hint: "Cancel and fix the SceneId values in the pasted text, then paste again.",
							});
							return;
						}
						const diagnostic = this.diagnoseManualBatch(corrected);
						if (diagnostic) {
							this.setManualImportError(diagnostic);
							return;
						}
						await this.options.onImportBatch(corrected, true);
						this.close();
					},
				}),
				this.makeActionButtonSpec({
					text: "Cancel import",
					icon: "x",
					subtle: true,
					onClick: async () => {
						this.close();
					},
				}),
			],
		});
	}

	private renderAssignments(parent: HTMLElement, batch: ReviewImportBatch): void {
		const destinationPlural = this.getDestinationNoun(batch, true);
		const summary = parent.createDiv({ cls: "editorialist-control-modal__summary" });
		summary.createDiv({
			text: `${batch.summary.totalMatchedScenes} matched ${destinationPlural} • ${batch.summary.totalSuggestions} formatted revision notes • ${batch.summary.totalUnresolvedScenes} unresolved ${destinationPlural} • ${batch.summary.totalMismatches} mismatches`,
		});
		summary.createDiv({
			text: `${batch.summary.totalResolvedScenes} ready • ${batch.summary.totalExactMatches} exact • ${batch.summary.totalAdvisoryOnly} advisory • ${batch.summary.totalUnresolvedMatches} need attention`,
		});

		const list = parent.createDiv({ cls: "editorialist-control-modal__list" });
		for (const group of batch.groups) {
			const card = list.createDiv({ cls: "editorialist-control-modal__group" });
			card.createDiv({
				cls: "editorialist-control-modal__group-title",
				text: group.sceneId ? `${group.sceneId} → ${group.fileName}` : group.fileName,
			});
			card.createDiv({
				cls: "editorialist-control-modal__group-meta",
				text:
					group.inferredCount > 0 && group.declaredCount === 0 && group.exactInferredCount === group.suggestions.length
						? `${group.exactInferredCount} exact match${group.exactInferredCount === 1 ? "" : "es"}`
						: `${group.suggestions.length} formatted revision notes • ${group.exactCount} exact • ${group.advisoryCount} advisory • ${group.mismatchCount} mismatched • ${group.unresolvedCount} unresolved`,
			});
			card.createDiv({
				cls: "editorialist-control-modal__group-path",
				text: group.filePath,
			});

			for (const result of group.suggestions) {
				card.createDiv({
					cls: "editorialist-control-modal__item",
					text: `${this.toSentenceCase(result.suggestion.operation)} • ${this.getRouteSourceLabel(result.routeStrategy)} • ${this.toSentenceCase(result.verificationStatus)}: ${result.verificationReason}`,
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
			text: `Unresolved ${destinationPlural}`,
		});
		for (const result of unresolved) {
			unresolvedCard.createDiv({
				cls: "editorialist-control-modal__item",
				text: `${result.suggestion.routing?.sceneId ?? result.suggestion.id} • ${this.getRouteSourceLabel(result.routeStrategy)} • ${result.routeReason}`,
			});
		}
	}

	private renderExample(parent: HTMLElement): void {
		const example = parent.createDiv({ cls: "editorialist-control-modal__example" });
		const header = example.createDiv({ cls: "editorialist-control-modal__example-header" });
		header.createDiv({
			cls: "editorialist-control-modal__section-title",
			text: ADVANCED_REVIEW_TEMPLATE_TITLE,
		});

		const actions = header.createDiv({ cls: "editorialist-control-modal__example-actions" });
		const copy = new ButtonComponent(actions)
			.setButtonText("Copy formatting instructions")
			.onClick(() => {
				void this.runAction(async () => {
					await this.options.onCopyTemplate();
				});
			});
		copy.buttonEl.addClass("editorialist-control-modal__example-button");
		setIcon(copy.buttonEl.createSpan({ cls: "editorialist-control-modal__button-icon" }), "copy");

		const toggle = new ButtonComponent(actions)
			.setIcon(this.showExample ? "chevron-up" : "chevron-down")
			.setTooltip(this.showExample ? "Hide formatting instructions" : "Show formatting instructions")
			.onClick(() => {
				this.showExample = !this.showExample;
				this.render();
			});
		toggle.buttonEl.addClass("editorialist-control-modal__example-toggle");

		if (!this.showExample) {
			return;
		}

		example.createDiv({
			cls: "editorialist-control-modal__example-description",
			text: `Use this advanced template with your AI. Supported operations: ${SUPPORTED_REVIEW_OPERATION_SUMMARY}. Return only the fenced block. No extra text.`,
		});

		example.createEl("pre", {
			cls: "editorialist-control-modal__example-block",
			text: REVIEW_TEMPLATE_BLOCK,
		});
	}

	private renderDetectionGrid(parent: HTMLElement, batch?: ReviewImportBatch): void {
		const items = this.getDetectionItems(batch);
		const grid = parent.createDiv({ cls: "editorialist-control-modal__detection-grid" });
		if (items.length >= 3) {
			grid.addClass("editorialist-control-modal__detection-grid--triple");
		}
		for (const item of items) {
			const card = grid.createDiv({
				cls: `editorialist-control-modal__detection editorialist-control-modal__detection--${item.tone}${item.emphasized ? " is-emphasized" : ""}${item.disabled ? " is-disabled" : ""}`,
			});
			card.setAttribute("role", "button");
			card.tabIndex = item.disabled || this.isWorking ? -1 : 0;
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

	private renderSelectionSummary(parent: HTMLElement, batch?: ReviewImportBatch): void {
		const items = this.getDetectionItems(batch);
		const availableCount = items.filter((item) => !item.disabled).length;
		const selectionSummary = this.getSelectionSummary(items);
		parent.createDiv({
			cls: "editorialist-control-modal__card-title",
			text: selectionSummary.title,
		});
		parent.createDiv({
			cls: "editorialist-control-modal__card-copy",
			text: `${availableCount} option${availableCount === 1 ? "" : "s"} available${selectionSummary.copy ? ` • ${selectionSummary.copy}` : ""}`,
		});
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
		buildModalFooter(parent, {
			className: "editorialist-control-modal__secondary-actions",
			buttons: actionsConfig.map((action) =>
				this.makeActionButtonSpec({
					text: action.label,
					icon: action.icon,
					subtle: true,
					onClick: action.onClick,
				}),
			),
		});
	}

	private renderManualImportError(parent: HTMLElement, error: ManualImportError): void {
		const panel = parent.createDiv({ cls: "editorialist-control-modal__import-error" });
		const head = panel.createDiv({ cls: "editorialist-control-modal__import-error-head" });
		const icon = head.createSpan({ cls: "editorialist-control-modal__import-error-icon" });
		setIcon(icon, "alert-triangle");
		head.createDiv({
			cls: "editorialist-control-modal__import-error-headline",
			text: error.headline,
		});
		for (const detail of error.details) {
			panel.createDiv({
				cls: "editorialist-control-modal__import-error-detail",
				text: detail,
			});
		}
		if (error.hint) {
			const hint = panel.createDiv({ cls: "editorialist-control-modal__import-error-hint" });
			const hintIcon = hint.createSpan({ cls: "editorialist-control-modal__import-error-hint-icon" });
			setIcon(hintIcon, "lightbulb");
			hint.createSpan({
				cls: "editorialist-control-modal__import-error-hint-text",
				text: error.hint,
			});
		}
	}

	private async ensureManualBatch(): Promise<ReviewImportBatch | null> {
		const rawText = this.manualText.trim();
		if (!rawText) {
			return null;
		}

		let batch: ReviewImportBatch;
		try {
			batch = await this.options.onInspectBatch(rawText);
		} catch {
			this.setManualImportError({
				headline: "Could not parse the pasted text",
				details: [
					"Editorialist tried to read the paste as formatted revision notes but the parser threw an error.",
					"If you copied from a chat UI, the response may have been truncated or wrapped in extra formatting.",
				],
				hint: "Try copying the AI's reply again — only the metadata header through the last operation block.",
			});
			return null;
		}

		const diagnostic = this.diagnoseManualBatch(batch);
		if (diagnostic) {
			this.setManualImportError(diagnostic);
			return null;
		}

		this.clearManualImportError();
		this.manualBatch = batch;
		this.manualValidationState = "ok";
		return batch;
	}

	// Schedules a debounced validation pass so the diagnostic panel and the
	// import button update reactively as the user pastes/edits — they don't have
	// to click a button to find out the paste is rejected.
	private scheduleManualValidation(): void {
		if (this.manualValidationTimer !== null) {
			window.clearTimeout(this.manualValidationTimer);
		}
		const trimmed = this.manualText.trim();
		if (!trimmed) {
			this.manualValidationState = "idle";
			this.manualImportError = null;
			this.manualBatch = null;
			this.render();
			return;
		}
		this.manualValidationState = "pending";
		this.manualImportError = null;
		this.manualValidationTimer = window.setTimeout(() => {
			this.manualValidationTimer = null;
			void this.runManualValidation();
		}, 450);
	}

	private async runManualValidation(): Promise<void> {
		const myToken = ++this.manualValidationToken;
		const rawText = this.manualText.trim();
		if (!rawText) {
			return;
		}

		let batch: ReviewImportBatch;
		try {
			batch = await this.options.onInspectBatch(rawText);
		} catch {
			if (myToken !== this.manualValidationToken) {
				return;
			}
			this.manualBatch = null;
			this.manualValidationState = "error";
			this.manualImportError = {
				headline: "Could not parse the pasted text",
				details: [
					"Editorialist tried to read the paste as formatted revision notes but the parser threw an error.",
					"If you copied from a chat UI, the response may have been truncated or wrapped in extra formatting.",
				],
				hint: "Try copying the AI's reply again — only the metadata header through the last operation block.",
			};
			this.render();
			return;
		}

		if (myToken !== this.manualValidationToken) {
			return;
		}

		const diagnostic = this.diagnoseManualBatch(batch);
		if (diagnostic) {
			this.manualBatch = null;
			this.manualValidationState = "error";
			this.manualImportError = diagnostic;
		} else {
			this.manualBatch = batch;
			this.manualValidationState = "ok";
			this.manualImportError = null;
		}
		this.render();
	}

	private diagnoseManualBatch(batch: ReviewImportBatch): ManualImportError | null {
		if (batch.summary.totalSuggestions === 0) {
			return {
				headline: "No formatted revision notes detected",
				details: [
					"Editorialist looks for `=== EDIT ===`, `=== MEMO ===`, `=== CUT ===`, `=== CONDENSE ===`, `=== EXPAND ===`, or `=== MOVE ===` section markers.",
					"The paste needs a metadata header (Template:, Reviewer:, etc.) followed by at least one operation block.",
				],
				hint: "Click 'Copy formatting instructions' below to see the expected shape, then run it through your AI again.",
			};
		}

		const hasReadyGroup = batch.groups.some((group) => group.isReady);
		if (!hasReadyGroup) {
			const unmatchedIds = this.collectUniqueUnmatchedSceneIds(batch, 3);
			const details: string[] = [];
			if (this.options.activeBookLabel) {
				details.push(`Active book: ${this.options.activeBookLabel}.`);
			} else {
				details.push("No active book is set. Editorialist needs an active book to route scene-level suggestions — open a scene in your manuscript folder first.");
			}
			if (unmatchedIds.length > 0) {
				const noun = unmatchedIds.length === 1 ? "id" : "ids";
				details.push(`Unmatched SceneId ${noun}: ${unmatchedIds.join(", ")}.`);
				details.push("These ids don't exist in the active book. Most likely the AI invented them — they look like real ids (e.g. `scn_eb08b7ef`) but no scene file in your vault has them.");
			} else {
				details.push("Suggestions had no SceneId or had routing values that didn't resolve to a scene.");
			}
			return {
				headline: `${batch.summary.totalSuggestions} suggestion${batch.summary.totalSuggestions === 1 ? "" : "s"} parsed, but none matched a scene`,
				details,
				hint: "Open the scene you want reviewed, then click 'Copy formatting instructions' — the prompt includes your real scene ids and tells the AI not to invent them.",
			};
		}

		return null;
	}

	private collectUniqueUnmatchedSceneIds(batch: ReviewImportBatch, limit: number): string[] {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const result of batch.results) {
			if (result.routeStatus === "resolved") {
				continue;
			}
			const id = result.suggestion.routing?.sceneId?.trim();
			if (!id || seen.has(id)) {
				continue;
			}
			seen.add(id);
			out.push(id);
			if (out.length >= limit) {
				break;
			}
		}
		return out;
	}

	private setManualImportError(error: ManualImportError): void {
		this.manualImportError = error;
		this.manualBatch = null;
		this.showAssignments = false;
		this.render();
	}

	private clearManualImportError(): void {
		this.manualImportError = null;
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

	private getReadySceneShortLabels(batch: ReviewImportBatch): string[] {
		const labels: string[] = [];
		for (const group of batch.groups) {
			if (!group.isReady) continue;
			const match = group.fileName.match(/\d+/);
			labels.push(match ? `S${parseInt(match[0], 10)}` : group.fileName);
		}
		return labels;
	}

	private formatReadyScenesDescription(batch: ReviewImportBatch): string {
		const total = batch.summary.totalResolvedScenes ?? 0;
		const noun = total === 1 ? "scene" : "scenes";
		const labels = this.getReadySceneShortLabels(batch);
		if (labels.length === 0) {
			return `${total} matched ${noun} ready`;
		}
		const maxShown = 6;
		const shown = labels.slice(0, maxShown).join(", ");
		const more = labels.length > maxShown ? ` +${labels.length - maxShown}` : "";
		return `${total} matched ${noun} ready · ${shown}${more}`;
	}

	private hasAnySceneMatch(batch: ReviewImportBatch): boolean {
		return batch.summary.totalMatchedScenes > 0 || batch.summary.totalResolvedScenes > 0;
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

	private getSelectionSummary(items: DetectionItem[]): { copy?: string; title: string } {
		const currentUnitLabel = this.options.noteUnitLabel ?? "note";
		const nextLabel = this.options.nextNoteLabel;
		const isCurrentComplete = this.options.currentNoteHasReviewBlock && this.options.currentNoteStatus === "completed";
		if (isCurrentComplete && nextLabel) {
			return {
				title: `Current ${currentUnitLabel} complete`,
				copy: `Continue with ${nextLabel} or reopen this ${currentUnitLabel}`,
			};
		}

		if (isCurrentComplete) {
			return {
				title: `Current ${currentUnitLabel} complete`,
				copy: `This ${currentUnitLabel} is already processed`,
			};
		}

		if (items.some((item) => item.id === "next-note")) {
			return {
				title: "Please make your selection",
				copy: `Continue with the next ${currentUnitLabel} when you are ready`,
			};
		}

		return {
			title: "Please make your selection",
		};
	}

	private getDetectionItems(batch?: ReviewImportBatch): DetectionItem[] {
		const activeBatch = this.clipboardBatch?.batch ?? batch;
		const localNoteBatch = activeBatch ? this.isLocalNoteBatch(activeBatch) : false;
		const currentUnitLabel = this.options.noteUnitLabel ?? "note";
		const currentNoteStatus = this.options.currentNoteStatus ?? "ready";
		const isCurrentComplete = currentNoteStatus === "completed";
		const clipboardDescription =
			this.clipboardState === "ready"
				? "Formatted revision notes found"
				: this.clipboardState === "empty"
					? "No formatted revision notes"
					: "Checking clipboard";

		if (this.options.currentNoteHasReviewBlock) {
			const items: DetectionItem[] = [
				{
					actionLabel: "Start review in current note",
					actionHint: isCurrentComplete ? `→ Open completed ${currentUnitLabel}` : "→ Start review",
					emphasized: !isCurrentComplete,
					icon: "file-text",
					id: "current-note",
					label: this.options.activeNoteLabel ? `Current ${currentUnitLabel}: ${this.options.activeNoteLabel}` : `Current ${currentUnitLabel}`,
					description: isCurrentComplete ? "All revision notes already processed" : "Formatted revision notes found",
					tone: isCurrentComplete ? "muted" : "success",
				},
			];

			if (isCurrentComplete && this.options.nextNoteLabel) {
				items.push({
					actionLabel: `Open next ${currentUnitLabel}`,
					actionHint: `→ Open next ${currentUnitLabel}`,
					emphasized: true,
					icon: "arrow-right",
					id: "next-note",
					label: `Next ${currentUnitLabel}: ${this.options.nextNoteLabel}`,
					description: `Continue review in the next ${currentUnitLabel}`,
					tone: "success",
				});
			}

			items.push({
				actionLabel: this.clipboardState === "ready" ? "Preview clipboard notes" : "Paste formatted revision notes",
				actionHint:
					this.clipboardState === "ready"
						? "→ Preview notes"
						: "→ Paste review",
				emphasized: false,
				icon: "clipboard",
				id: "clipboard",
				label: "Clipboard",
				description: clipboardDescription,
				tone: this.getClipboardTone(),
			});

			return items;
		}

		if (this.clipboardBatch || batch) {
			const readyGroups = activeBatch ? this.hasImportReadyGroup(activeBatch) : false;
			const hasSceneMatches = activeBatch ? this.hasAnySceneMatch(activeBatch) : false;

			return [
				{
					actionLabel: "Preview clipboard notes",
					actionHint: "→ Preview notes",
					emphasized: !readyGroups,
					icon: "clipboard",
					id: "clipboard",
					label: "Clipboard",
					description: "Formatted revision notes found",
					tone: "success",
				},
				{
					actionLabel: localNoteBatch
						? "Import into the current note"
						: readyGroups
							? "Import into matching scenes"
							: "No matching scenes found",
					actionHint: readyGroups
						? "→ Import review"
						: hasSceneMatches
							? "→ Review matches"
							: "→ No valid destination",
					disabled: localNoteBatch ? false : !readyGroups && !hasSceneMatches,
					emphasized: localNoteBatch || readyGroups,
					icon: localNoteBatch ? "file-text" : readyGroups ? "map-pinned" : "triangle-alert",
					id: "active-book",
					label: localNoteBatch
						? (this.options.activeNoteLabel ? `Current note: ${this.options.activeNoteLabel}` : "Current note")
						: "Matching scenes",
					description: localNoteBatch
						? "Ready for this note"
						: readyGroups && activeBatch
							? this.formatReadyScenesDescription(activeBatch)
						: hasSceneMatches
							? "Only ambiguous or unresolved scene matches found"
							: "No matching scene text found",
					tone: localNoteBatch || readyGroups ? "success" : "danger",
				},
			];
		}

		return [
			{
				actionLabel: "Copy formatting instructions",
				actionHint: "→ Copy instructions",
				emphasized: true,
				icon: "copy",
				id: "template",
				label: "Copy instructions",
				description: `${ADVANCED_REVIEW_TEMPLATE_TITLE} for ${SUPPORTED_REVIEW_OPERATION_SUMMARY}`,
				tone: "success",
			},
			{
				actionLabel: "Paste formatted revision notes",
				actionHint: "→ Paste review",
				emphasized: false,
				icon: "clipboard",
				id: "clipboard",
				label: "Clipboard",
				description: "No formatted revision notes",
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

		if (id === "next-note") {
			await this.options.onStartReviewInNextNote();
			this.close();
			return;
		}

		if (id === "clipboard") {
			if (this.clipboardBatch) {
				this.showAssignments = true;
				this.render();
				return;
			}

			this.showManualPaste = true;
			this.render();
			return;
		}

		if (id === "active-book") {
			if (!this.clipboardBatch) {
				return;
			}

			if (this.isLocalNoteBatch(this.clipboardBatch.batch)) {
				await this.options.onImportRawToActiveNote(this.clipboardBatch.rawText, true);
				this.close();
				return;
			}

			if (!this.hasImportReadyGroup(this.clipboardBatch.batch)) {
				if (this.hasAnySceneMatch(this.clipboardBatch.batch)) {
					this.showAssignments = true;
					this.render();
					return;
				}

				new Notice("No matching scene text was found in the active notes.");
				return;
			}

			// Mis-targeted entries must never auto-import. Drop into the manual
			// paste view so the author sees the correction panel and decides.
			if (this.collectProposedCorrections(this.clipboardBatch.batch).length > 0) {
				this.manualText = this.clipboardBatch.rawText;
				this.manualBatch = this.clipboardBatch.batch;
				this.manualValidationState = "ok";
				this.manualImportError = null;
				this.showManualPaste = true;
				this.render();
				return;
			}

			await this.options.onImportBatch(this.clipboardBatch.batch, true);
			this.close();
		}
	}

	// Adapter that maps EditorialistModal's per-action button shape (cta /
	// disabled / icon / subtle / async onClick) onto a ModalFooterButtonSpec.
	// Behavior matches the prior inline `buildButton`:
	//   • base class `editorialist-control-modal__button` is always applied
	//   • `subtle: true` adds the `--subtle` modifier
	//   • the icon span uses the modal-specific `__button-icon` class so the
	//     existing CSS for that selector keeps applying byte-identically
	//   • disabled resolves at build time as `options.disabled || this.isWorking`
	//     — re-renders (triggered by runAction) rebuild the footer with the
	//     refreshed value, preserving the loading-state lockout
	//   • onClick is wrapped in `runAction` so the async work toggles isWorking
	//     and re-renders exactly as before
	private makeActionButtonSpec(spec: {
		text: string;
		cta?: boolean;
		disabled?: boolean;
		icon?: string;
		subtle?: boolean;
		onClick: () => Promise<void>;
	}): ModalFooterButtonSpec {
		const classNames: string[] = ["editorialist-control-modal__button"];
		if (spec.subtle) {
			classNames.push("editorialist-control-modal__button--subtle");
		}
		return {
			text: spec.text,
			cta: spec.cta,
			className: classNames,
			disabled: Boolean(spec.disabled || this.isWorking),
			icon: spec.icon,
			iconClassName: spec.icon ? "editorialist-control-modal__button-icon" : undefined,
			onClick: () => {
				void this.runAction(spec.onClick);
			},
		};
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

	private getRouteSourceLabel(value: ReviewImportBatch["results"][number]["routeStrategy"]): string {
		switch (value) {
			case "declared_scene_id":
				return "SceneId";
			case "declared_path":
				return "Path hint";
			case "declared_note":
				return "Note hint";
			case "declared_scene":
				return "Scene hint";
			case "inferred_exact":
				return "Exact text";
			case "inferred_normalized":
				return "Normalized text";
			case "fallback_active_note":
				return "Active note (fallback)";
			case "corrected_target":
				return "Re-targeted by author";
			case "unresolved":
				return "Needs attention";
		}
	}

	private getDestinationNoun(batch: ReviewImportBatch, plural: boolean): string {
		const noun = this.isLocalNoteBatch(batch) ? "note" : "scene";
		return plural ? `${noun}s` : noun;
	}

}
