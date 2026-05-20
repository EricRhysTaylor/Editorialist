import { ButtonComponent, setIcon } from "obsidian";
import type EditorialistPlugin from "../main";
import type { SupportedReviewOperationType } from "../models/ReviewSuggestion";
import { bindImmediateAction } from "./util/bindImmediateAction";
import type { ToolbarKeyTracker } from "./toolbar/ToolbarKeyTracker";

const OPERATION_ICONS: Record<SupportedReviewOperationType, string> = {
	edit: "file-pen-line",
	cut: "scissors-line-dashed",
	condense: "minimize-2",
	move: "arrow-right-left",
};

export interface ReviewToolbarState {
	mode: "review";
	anchorDirection?: "above" | "below";
	canApply: boolean;
	canDefer: boolean;
	canNext: boolean;
	canPrevious: boolean;
	canReject: boolean;
	canRewrite: boolean;
	canUndoLastAccept: boolean;
	acceptedCount: number;
	completionLabel?: string;
	deferredCount: number;
	hasReviewBlock: boolean;
	operation: SupportedReviewOperationType;
	operationLabel: string;
	pendingCount: number;
	rejectedCount: number;
	rewrittenCount: number;
	sceneProgressLabel?: string;
	selectedIndexLabel: string;
	selectedLabel: string;
	unresolvedDetails?: string;
	unresolvedCount: number;
}

export interface HandoffToolbarState {
	mode: "handoff";
	currentLabel: string;
	isFinal: boolean;
	primaryActionLabel: string;
	progressLabel: string;
	secondaryActionLabel?: string;
	title: string;
}

export interface PanelToolbarState {
	mode: "panel";
	progressLabel?: string;
	remainingLabel: string;
	title: string;
}

export interface AppliedReviewToolbarState {
	mode: "applied_review";
	canUndo: boolean;
	currentIndexLabel: string;
	title: string;
}

export interface AcceptedReviewToolbarState {
	mode: "accepted_review";
	canNext: boolean;
	canPrevious: boolean;
	canUndo: boolean;
	currentIndexLabel: string;
	title: string;
}

export interface BulkConfirmToolbarState {
	mode: "bulk_confirm";
	countLabel: string;
	title: string;
}

export interface CompletedReviewToolbarState {
	mode: "completed_review";
	canNext: boolean;
	canPrevious: boolean;
	canUndo: boolean;
	currentIndexLabel?: string;
	title: string;
}

export interface PendingEditsBriefContextState {
	noteTitle: string;
	notePath: string;
	summary: string;
}

export interface PendingEditsReviewToolbarState {
	mode: "pending_edits_review";
	title: string;
	sceneLabel: string;
	segmentKindLabel: string;
	segmentIndexLabel: string;
	segmentMutedPrefix?: string;
	segmentActionText: string;
	briefContext?: PendingEditsBriefContextState;
	canComplete: boolean;
	canNext: boolean;
	canPrevious: boolean;
}

export type ToolbarState =
	| ReviewToolbarState
	| BulkConfirmToolbarState
	| HandoffToolbarState
	| PanelToolbarState
	| AppliedReviewToolbarState
	| AcceptedReviewToolbarState
	| CompletedReviewToolbarState
	| PendingEditsReviewToolbarState;

export function createReviewToolbarElement(
	plugin: EditorialistPlugin,
	state: ToolbarState,
): HTMLElement {
	const tracker = plugin.getToolbarKeyTracker();
	const overlay = document.createElement("div");
	overlay.classList.add("editorialist-toolbar-overlay");
	markAsNonEditorSurface(overlay);

	const toolbar = overlay.createDiv({ cls: "editorialist-toolbar" });
	markAsNonEditorSurface(toolbar);
	toolbar.setAttribute("role", "toolbar");

	if (state.mode === "handoff") {
		toolbar.addClass("editorialist-toolbar--handoff");
		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.progressLabel);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildActionButton(
			actions,
			state.primaryActionLabel,
			state.isFinal ? "check-check" : "arrow-right",
			() => {
				if (state.isFinal) {
					void plugin.finishGuidedSweep();
					return;
				}

				void plugin.continueGuidedSweep();
			},
		);
		if (state.secondaryActionLabel) {
			buildActionButton(actions, state.secondaryActionLabel, "flag", () => {
				void plugin.finishGuidedSweep();
			}, true);
		}
		return overlay;
	}

	if (state.mode === "panel") {
		toolbar.addClass("editorialist-toolbar--panel");
		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title);
		if (state.progressLabel) {
			renderMetaSeparator(meta);
			renderMetaSegment(meta, state.progressLabel);
		}
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.remainingLabel);
		return overlay;
	}

	if (state.mode === "bulk_confirm") {
		toolbar.addClass("editorialist-toolbar--bulk-confirm");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, "Cancel bulk apply", "x", () => {
			plugin.cancelApplyAndReviewConfirmMode();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta editorialist-toolbar__meta--centered" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--negative");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.countLabel);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildActionButton(actions, "Cancel", "arrow-left", () => {
			plugin.cancelApplyAndReviewConfirmMode();
		}, true);
		buildActionButton(actions, "Confirm", "triangle-alert", () => {
			void plugin.confirmApplyAndReviewSceneSuggestions();
		});
		return overlay;
	}

	if (state.mode === "applied_review") {
		toolbar.addClass("editorialist-toolbar--panel");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, "Finish review", "x", () => {
			void plugin.finishActiveReview();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta editorialist-toolbar__meta--centered" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.currentIndexLabel);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildButton(actions, tracker, "Previous", "arrow-left", () => {
			void plugin.selectPreviousAppliedReviewChange();
		}, false);
		buildButton(actions, tracker, "Next", "arrow-right", () => {
			void plugin.selectNextAppliedReviewChange();
		}, false);
		if (state.canUndo) {
			buildButton(actions, tracker, "Undo", "rotate-ccw", () => {
				void plugin.undoLastAppliedSuggestion();
			}, false);
		}
		return overlay;
	}

	if (state.mode === "accepted_review") {
		toolbar.addClass("editorialist-toolbar--panel");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, "Finish review", "x", () => {
			void plugin.finishActiveReview();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta editorialist-toolbar__meta--centered" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.currentIndexLabel);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildButton(actions, tracker, "Previous", "arrow-left", () => {
			void plugin.selectPreviousAcceptedSuggestion();
		}, !state.canPrevious);
		buildButton(actions, tracker, "Next", "arrow-right", () => {
			void plugin.selectNextAcceptedSuggestion();
		}, !state.canNext);
		if (state.canUndo) {
			buildButton(actions, tracker, "Undo", "rotate-ccw", () => {
				void plugin.undoLastAppliedSuggestion();
			}, false);
		}
		return overlay;
	}

	if (state.mode === "pending_edits_review") {
		toolbar.addClass("editorialist-toolbar--pending-edits");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, "Close pending edits review", "x", () => {
			void plugin.closePendingEditsReview();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.sceneLabel);
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.segmentKindLabel);
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.segmentIndexLabel);

		if (state.briefContext) {
			const briefBlock = toolbar.createDiv({ cls: "editorialist-toolbar__pending-brief" });
			markAsNonEditorSurface(briefBlock);
			const briefHeader = briefBlock.createDiv({ cls: "editorialist-toolbar__pending-brief-header" });
			markAsNonEditorSurface(briefHeader);
			const briefIcon = briefHeader.createSpan({ cls: "editorialist-toolbar__pending-brief-icon" });
			setIcon(briefIcon, "book-open");
			const briefLink = briefHeader.createEl("a", {
				cls: "editorialist-toolbar__pending-brief-link",
				attr: {
					href: "#",
					title: `Open brief: ${state.briefContext.noteTitle}`,
				},
				text: state.briefContext.noteTitle,
			});
			markAsNonEditorSurface(briefLink);
			const targetPath = state.briefContext.notePath;
			bindImmediateAction(briefLink, () => {
				plugin.openInquiryBriefNote(targetPath);
			});
			const briefSummary = briefBlock.createDiv({
				cls: "editorialist-toolbar__pending-brief-summary",
				text: state.briefContext.summary,
			});
			markAsNonEditorSurface(briefSummary);
		}

		const body = toolbar.createDiv({ cls: "editorialist-toolbar__pending-body" });
		markAsNonEditorSurface(body);
		if (state.segmentMutedPrefix) {
			const prefix = body.createSpan({
				cls: "editorialist-toolbar__pending-body-prefix",
				text: state.segmentMutedPrefix,
			});
			markAsNonEditorSurface(prefix);
		}
		const action = body.createSpan({
			cls: "editorialist-toolbar__pending-body-action",
			text: state.segmentActionText,
		});
		markAsNonEditorSurface(action);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildButton(actions, tracker, "Previous", "arrow-left", () => {
			void plugin.selectPreviousPendingEditSegment();
		}, !state.canPrevious);
		buildButton(
			actions,
			tracker,
			"Next (leave item in pending edits)",
			"arrow-right",
			() => {
				void plugin.selectNextPendingEditSegment();
			},
			!state.canNext,
			true,
			undefined,
			true,
		);
		buildButton(
			actions,
			tracker,
			"Complete and remove from pending edits",
			"list-x",
			() => {
				void plugin.completeSelectedPendingEditSegment();
			},
			!state.canComplete,
		);
		return overlay;
	}

	if (state.mode === "completed_review") {
		toolbar.addClass("editorialist-toolbar--completed-review");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, "Finish review", "x", () => {
			void plugin.finishActiveReview();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta editorialist-toolbar__meta--centered" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		if (state.currentIndexLabel) {
			renderMetaSeparator(meta);
			renderMetaSegment(meta, state.currentIndexLabel);
		}

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildButton(actions, tracker, "Previous", "arrow-left", () => {
			void plugin.selectPreviousCompletedReviewSuggestion();
		}, !state.canPrevious);
		buildButton(actions, tracker, "Next", "arrow-right", () => {
			void plugin.selectNextCompletedReviewSuggestion();
		}, !state.canNext);
		if (state.canUndo) {
			buildButton(actions, tracker, "Undo", "rotate-ccw", () => {
				void plugin.undoLastAppliedSuggestion();
			}, false);
		}
		return overlay;
	}

	if (tracker.isLegendOpen()) {
		overlay.classList.add("editorialist-toolbar--legend-open");
	}

	{
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, "Hide toolbar", "x", () => {
			plugin.dismissReviewToolbar();
		});
		buildFlatIconButton(
			leading,
			tracker.isLegendOpen() ? "Hide shortcut legend" : "Show shortcut legend",
			"asterisk",
			() => {
				const nextOpen = tracker.toggleLegendOpen();
				overlay.classList.toggle("editorialist-toolbar--legend-open", nextOpen);
			},
		);
		if (state.mode === "review" && state.anchorDirection) {
			const indicator = leading.createSpan({
				cls: "editorialist-toolbar__anchor-indicator",
				text: state.anchorDirection === "above" ? "↑" : "↓",
			});
			markAsNonEditorSurface(indicator);
			indicator.setAttribute(
				"aria-label",
				state.anchorDirection === "above" ? "Insert point is above" : "Insert point is below",
			);
			indicator.setAttribute(
				"title",
				state.anchorDirection === "above" ? "Insert point is above" : "Insert point is below",
			);
		}
	}

	const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta" });
	markAsNonEditorSurface(meta);
	renderOperationBadge(meta, state.operation, state.operationLabel);
	const metaSegments: Array<{ text: string; cls?: string; title?: string }> = [];
	if (state.sceneProgressLabel) {
		metaSegments.push({ text: state.sceneProgressLabel });
	}
	metaSegments.push({ text: state.selectedIndexLabel });
	if (state.acceptedCount > 0) {
		metaSegments.push({
			text: `${state.acceptedCount} accepted`,
			cls: "editorialist-toolbar__meta-segment--positive",
		});
	}
	if (state.pendingCount > 0) {
		metaSegments.push({ text: `${state.pendingCount} pending` });
	}
	if (state.rejectedCount > 0) {
		metaSegments.push({
			text: `${state.rejectedCount} rejected`,
			cls: "editorialist-toolbar__meta-segment--negative",
		});
	}
	if (state.unresolvedCount > 0) {
		metaSegments.push({
			text: `${state.unresolvedCount} unresolved`,
			title: state.unresolvedDetails,
		});
	}
	if (state.deferredCount > 0) {
		metaSegments.push({ text: `${state.deferredCount} deferred` });
	}
	if (state.rewrittenCount > 0) {
		metaSegments.push({ text: `${state.rewrittenCount} rewritten` });
	}
	if (state.completionLabel) {
		metaSegments.push({
			text: state.completionLabel,
			cls: "editorialist-toolbar__meta-segment--positive",
		});
	}
	metaSegments.forEach((segment) => {
		renderMetaSeparator(meta);
		renderMetaSegment(meta, segment.text, segment.cls, segment.title);
	});

	const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
	const applyOperationLabel = state.operationLabel.toLowerCase();
	buildButton(actions, tracker, "Previous", "arrow-left", () => {
		void plugin.selectPreviousSuggestion();
	}, !state.canPrevious);
	buildButton(actions, tracker, "Next", "arrow-right", () => {
		void plugin.selectNextSuggestion();
	}, !state.canNext);
	buildButton(
		actions,
		tracker,
		`Apply ${applyOperationLabel}`,
		"check",
		() => {
			void plugin.acceptSelectedSuggestion();
		},
		!state.canApply,
		true,
		[
			{
				kind: "bulk",
				label: "Apply to all",
				icon: "list-checks",
				onClick: () => {
					void plugin.enterApplyAndReviewConfirmMode();
				},
				when: ({ modPressed, shiftPressed }) => shiftPressed && modPressed,
			},
			{
				kind: "advance",
				label: `Apply ${applyOperationLabel} and advance`,
				icon: "list-end",
				onClick: () => {
					void plugin.acceptSelectedSuggestionAndAdvance();
				},
				when: ({ modPressed, shiftPressed }) => shiftPressed && !modPressed,
			},
		],
	);
	buildButton(actions, tracker, "Defer", "clock", () => {
		plugin.deferSelectedSuggestion();
	}, !state.canDefer);
	buildButton(actions, tracker, "Rewrite myself", "pen-line", () => {
		void plugin.rewriteSelectedSuggestion();
	}, !state.canRewrite);
	if (state.canUndoLastAccept) {
		buildButton(actions, tracker, "Undo", "rotate-ccw", () => {
			void plugin.undoLastAppliedSuggestion();
		}, false);
	} else {
		buildButton(actions, tracker, "Reject", "circle-off", () => {
			void plugin.rejectSelectedSuggestion();
		}, !state.canReject);
	}

	renderToolbarLegend(toolbar, applyOperationLabel);

	return overlay;
}

// Compact reference for the action icons and the Apply button's modifier
// variants (the only button with shift/cmd alternates). Hidden by default;
// toggled by the "*" trigger in the leading cluster.
function renderToolbarLegend(parent: HTMLElement, applyOperationLabel: string): void {
	const legend = parent.createDiv({ cls: "editorialist-toolbar__legend" });
	markAsNonEditorSurface(legend);

	const rows: Array<{ icon: string; keys: string; label: string }> = [
		{ icon: "check", keys: "Click", label: `Apply ${applyOperationLabel}` },
		{ icon: "list-end", keys: "Shift", label: `Apply ${applyOperationLabel} and advance` },
		{ icon: "list-checks", keys: "Shift + Cmd", label: "Apply to all" },
		{ icon: "clock", keys: "Click", label: "Defer" },
		{ icon: "pen-line", keys: "Click", label: "Rewrite myself" },
		{ icon: "circle-off", keys: "Click", label: "Reject" },
		{ icon: "x", keys: "Click", label: "Hide toolbar" },
	];

	for (const row of rows) {
		const item = legend.createDiv({ cls: "editorialist-toolbar__legend-row" });
		markAsNonEditorSurface(item);
		const iconEl = item.createSpan({ cls: "editorialist-toolbar__legend-icon" });
		markAsNonEditorSurface(iconEl);
		setIcon(iconEl, row.icon);
		const keysEl = item.createSpan({ cls: "editorialist-toolbar__legend-keys", text: row.keys });
		markAsNonEditorSurface(keysEl);
		const labelEl = item.createSpan({ cls: "editorialist-toolbar__legend-label", text: row.label });
		markAsNonEditorSurface(labelEl);
	}
}

function buildFlatIconButton(
	parent: HTMLElement,
	label: string,
	icon: string,
	onClick: () => void,
): void {
	const button = parent.createDiv({
		cls: "ert-btn ert-btn--flat ert-btn--flat-icon ert-toolbar-close",
	});
	button.setAttribute("role", "button");
	button.setAttribute("tabindex", "0");
	button.setAttribute("aria-label", label);
	markAsNonEditorSurface(button);
	const iconEl = button.createSpan({ cls: "ert-toolbar-close__icon" });
	markAsNonEditorSurface(iconEl);
	setIcon(iconEl, icon);
	bindImmediateAction(button, () => {
		onClick();
	});
	button.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		onClick();
	});
}

function buildButton(	parent: HTMLElement,
	tracker: ToolbarKeyTracker,
	label: string,
	icon: string,
	onClick: () => void,
	disabled = false,
	isApply = false,
	alternateActions?: Array<{
		kind: "advance" | "bulk";
		label: string;
		icon: string;
		onClick: () => void;
		when: (state: { modPressed: boolean; shiftPressed: boolean }) => boolean;
	}>,
	autoFocus = false,
): void {
	const button = new ButtonComponent(parent);
	button.setDisabled(disabled);
	button.buttonEl.addClass("ert-btn", "ert-btn--flat", "editorialist-toolbar__button");
	if (isApply) {
		button.buttonEl.addClass("editorialist-toolbar__button--apply");
	}
	if (autoFocus && !disabled) {
		window.requestAnimationFrame(() => {
			if (button.buttonEl.isConnected) {
				button.buttonEl.focus();
			}
		});
	}
	markAsNonEditorSurface(button.buttonEl);
	const iconEl = button.buttonEl.createSpan({ cls: "editorialist-toolbar__button-icon" });
	markAsNonEditorSurface(iconEl);
	let unsubscribeShiftTracking: (() => void) | null = null;
	let removalObserver: MutationObserver | null = null;
	if (alternateActions && alternateActions.length > 0) {
		removalObserver = new MutationObserver(() => {
			if (!button.buttonEl.isConnected) {
				unsubscribeShiftTracking?.();
				unsubscribeShiftTracking = null;
				removalObserver?.disconnect();
			}
		});
	}

	const getActiveAlternateAction = (state: { modPressed: boolean; shiftPressed: boolean }) =>
		alternateActions?.find((action) => action.when(state)) ?? null;

	const applyPresentation = (state: { modPressed: boolean; shiftPressed: boolean }): void => {
		const activeAlternateAction = getActiveAlternateAction(state);
		const nextLabel = activeAlternateAction?.label ?? label;
		const nextIcon = activeAlternateAction?.icon ?? icon;
		button.buttonEl.setAttribute("aria-label", nextLabel);
		button.buttonEl.setAttribute("data-editorialist-modifier-mode", activeAlternateAction?.kind ?? "default");
		setIcon(iconEl, nextIcon);
	};

	if (alternateActions && alternateActions.length > 0) {
		unsubscribeShiftTracking = tracker.subscribe(applyPresentation);
	}
	removalObserver?.observe(document.body, {
		childList: true,
		subtree: true,
	});

	applyPresentation(tracker.getModifierState());
	bindImmediateAction(button.buttonEl, (event) => {
		const activeAlternateAction = getActiveAlternateAction({
			modPressed: event.metaKey || event.ctrlKey,
			shiftPressed: event.shiftKey,
		});
		if (activeAlternateAction) {
			activeAlternateAction.onClick();
			return;
		}

		onClick();
	});
}

function buildActionButton(
	parent: HTMLElement,
	label: string,
	icon: string,
	onClick: () => void,
	isSecondary = false,
): void {
	const button = new ButtonComponent(parent);
	button.buttonEl.addClass("ert-btn", "ert-btn--flat", "editorialist-toolbar__button", "editorialist-toolbar__button--text");
	if (isSecondary) {
		button.buttonEl.addClass("editorialist-toolbar__button--secondary");
	}
	markAsNonEditorSurface(button.buttonEl);
	button.buttonEl.setAttribute("aria-label", label);
	const iconEl = button.buttonEl.createSpan({ cls: "editorialist-toolbar__button-icon" });
	markAsNonEditorSurface(iconEl);
	setIcon(iconEl, icon);
	const labelEl = button.buttonEl.createSpan({ cls: "editorialist-toolbar__button-label", text: label });
	markAsNonEditorSurface(labelEl);
	bindImmediateAction(button.buttonEl, () => {
		onClick();
	});
}

function renderOperationBadge(
	parent: HTMLElement,
	operation: SupportedReviewOperationType,
	label: string,
): void {
	const badge = parent.createSpan({ cls: "editorialist-toolbar__operation" });
	markAsNonEditorSurface(badge);
	const iconEl = badge.createSpan({ cls: "editorialist-toolbar__operation-icon" });
	markAsNonEditorSurface(iconEl);
	setIcon(iconEl, OPERATION_ICONS[operation]);
	const labelEl = badge.createSpan({ cls: "editorialist-toolbar__operation-label", text: label });
	markAsNonEditorSurface(labelEl);
	badge.setAttribute("aria-label", label);
}

function renderMetaSegment(parent: HTMLElement, text: string, className?: string, title?: string): void {
	const segment = parent.createSpan({
		cls: className ? `editorialist-toolbar__meta-segment ${className}` : "editorialist-toolbar__meta-segment",
		text,
	});
	markAsNonEditorSurface(segment);
	if (title) {
		segment.setAttribute("title", title);
		segment.setAttribute("aria-label", `${text}. ${title}`);
	}
}

function renderMetaSeparator(parent: HTMLElement): void {
	const separator = parent.createSpan({
		cls: "editorialist-toolbar__meta-separator",
		text: "•",
	});
	markAsNonEditorSurface(separator);
}


// Modifier-key tracking, the legend-open flag, and the corresponding window
// listener lifecycle now live on ToolbarKeyTracker (see
// src/ui/toolbar/ToolbarKeyTracker.ts). One tracker is owned per plugin
// instance and disposed in onunload. The previous module-level
// shiftKeyPressed / modKeyPressed / legendOpen / shiftTrackingAbort /
// modifierSubscribers and the exported forceTeardownToolbarSubscriptions()
// helper are gone.

function markAsNonEditorSurface(element: HTMLElement): void {
	element.setAttribute("contenteditable", "false");
	element.setAttribute("spellcheck", "false");
	element.setAttribute("translate", "no");
	element.setAttribute("data-gramm", "false");
	element.setAttribute("data-gramm_editor", "false");
	element.setAttribute("data-enable-grammarly", "false");
	element.setAttribute("data-grammarly-part", "false");
	element.setAttribute("data-lexical-editor", "false");
}
