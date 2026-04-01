import { ButtonComponent, setIcon } from "obsidian";
import type EditorialistPlugin from "../main";

let shiftKeyPressed = false;
let modKeyPressed = false;
let shiftTrackingAbort: AbortController | null = null;
const modifierSubscribers = new Set<(state: { modPressed: boolean; shiftPressed: boolean }) => void>();

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
	operationLabel: string;
	pendingCount: number;
	rejectedCount: number;
	rewrittenCount: number;
	sceneProgressLabel?: string;
	selectedIndexLabel: string;
	selectedLabel: string;
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

export type ToolbarState =
	| ReviewToolbarState
	| BulkConfirmToolbarState
	| HandoffToolbarState
	| PanelToolbarState
	| AppliedReviewToolbarState
	| AcceptedReviewToolbarState
	| CompletedReviewToolbarState;

export function createReviewToolbarElement(
	plugin: EditorialistPlugin,
	state: ToolbarState,
): HTMLElement {
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
		buildFlatIconButton(leading, "Exit review", "x", () => {
			void plugin.closeReviewPanel();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta editorialist-toolbar__meta--centered" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.currentIndexLabel);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildButton(actions, "Previous", "arrow-left", () => {
			void plugin.selectPreviousAppliedReviewChange();
		}, false);
		buildButton(actions, "Next", "arrow-right", () => {
			void plugin.selectNextAppliedReviewChange();
		}, false);
		if (state.canUndo) {
			buildButton(actions, "Undo", "rotate-ccw", () => {
				void plugin.undoLastAppliedSuggestion();
			}, false);
		}
		return overlay;
	}

	if (state.mode === "accepted_review") {
		toolbar.addClass("editorialist-toolbar--panel");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, "Exit review", "x", () => {
			void plugin.closeReviewPanel();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta editorialist-toolbar__meta--centered" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.currentIndexLabel);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildButton(actions, "Previous", "arrow-left", () => {
			void plugin.selectPreviousAcceptedSuggestion();
		}, false);
		buildButton(actions, "Next", "arrow-right", () => {
			void plugin.selectNextAcceptedSuggestion();
		}, false);
		if (state.canUndo) {
			buildButton(actions, "Undo", "rotate-ccw", () => {
				void plugin.undoLastAppliedSuggestion();
			}, false);
		}
		return overlay;
	}

	if (state.mode === "completed_review") {
		toolbar.addClass("editorialist-toolbar--completed-review");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, "Close review", "x", () => {
			void plugin.closeReviewPanel();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta editorialist-toolbar__meta--centered" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		if (state.currentIndexLabel) {
			renderMetaSeparator(meta);
			renderMetaSegment(meta, state.currentIndexLabel);
		}

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildButton(actions, "Previous", "arrow-left", () => {
			void plugin.selectPreviousCompletedReviewSuggestion();
		}, !state.canPrevious);
		buildButton(actions, "Next", "arrow-right", () => {
			void plugin.selectNextCompletedReviewSuggestion();
		}, !state.canNext);
		if (state.canUndo) {
			buildButton(actions, "Undo", "rotate-ccw", () => {
				void plugin.undoLastAppliedSuggestion();
			}, false);
		}
		return overlay;
	}

	{
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, "Close review", "x", () => {
			void plugin.closeReviewPanel();
		});
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
	const metaSegments: Array<{ text: string; cls?: string }> = [
		{ text: state.operationLabel },
	];
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
		metaSegments.push({ text: `${state.unresolvedCount} unresolved` });
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
	metaSegments.forEach((segment, index) => {
		if (index > 0) {
			renderMetaSeparator(meta);
		}
		renderMetaSegment(meta, segment.text, segment.cls);
	});

	const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
	const applyOperationLabel = state.operationLabel.toLowerCase();
	buildButton(actions, "Previous", "arrow-left", () => {
		void plugin.selectPreviousSuggestion();
	}, !state.canPrevious);
	buildButton(actions, "Next", "arrow-right", () => {
		void plugin.selectNextSuggestion();
	}, !state.canNext);
	buildButton(
		actions,
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
	buildButton(actions, "Defer", "clock", () => {
		plugin.deferSelectedSuggestion();
	}, !state.canDefer);
	buildButton(actions, "Rewrite myself", "pen-line", () => {
		void plugin.rewriteSelectedSuggestion();
	}, !state.canRewrite);
	if (state.canUndoLastAccept) {
		buildButton(actions, "Undo", "rotate-ccw", () => {
			void plugin.undoLastAppliedSuggestion();
		}, false);
	} else {
		buildButton(actions, "Reject", "x", () => {
			void plugin.rejectSelectedSuggestion();
		}, !state.canReject);
	}

	return overlay;
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

function buildButton(
	parent: HTMLElement,
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
): void {
	const button = new ButtonComponent(parent);
	button.setDisabled(disabled);
	button.buttonEl.addClass("editorialist-toolbar__button");
	if (isApply) {
		button.buttonEl.addClass("editorialist-toolbar__button--apply");
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
		unsubscribeShiftTracking = subscribeToModifierKeys(applyPresentation);
	}
	removalObserver?.observe(document.body, {
		childList: true,
		subtree: true,
	});

	applyPresentation({ modPressed: modKeyPressed, shiftPressed: shiftKeyPressed });
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
	button.buttonEl.addClass("editorialist-toolbar__button", "editorialist-toolbar__button--text");
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

function renderMetaSegment(parent: HTMLElement, text: string, className?: string): void {
	const segment = parent.createSpan({
		cls: className ? `editorialist-toolbar__meta-segment ${className}` : "editorialist-toolbar__meta-segment",
		text,
	});
	markAsNonEditorSurface(segment);
}

function renderMetaSeparator(parent: HTMLElement): void {
	const separator = parent.createSpan({
		cls: "editorialist-toolbar__meta-separator",
		text: "•",
	});
	markAsNonEditorSurface(separator);
}

function bindImmediateAction(
	element: HTMLElement,
	onClick: (event: MouseEvent | PointerEvent) => void,
): void {
	let handledPointerDown = false;

	element.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) {
			return;
		}

		handledPointerDown = true;
		event.preventDefault();
		event.stopPropagation();
		onClick(event);
	});

	element.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (handledPointerDown) {
			handledPointerDown = false;
			return;
		}

		onClick(event);
	});
}

function subscribeToModifierKeys(callback: (state: { modPressed: boolean; shiftPressed: boolean }) => void): () => void {
	ensureShiftTracking();
	modifierSubscribers.add(callback);
	callback({ modPressed: modKeyPressed, shiftPressed: shiftKeyPressed });
	return () => {
		modifierSubscribers.delete(callback);
		if (modifierSubscribers.size === 0) {
			teardownShiftTracking();
		}
	};
}

function ensureShiftTracking(): void {
	if (shiftTrackingAbort) {
		return;
	}

	shiftTrackingAbort = new AbortController();
	const { signal } = shiftTrackingAbort;
	window.addEventListener("keydown", (event) => {
		updateModifierKeyState({ modPressed: event.metaKey || event.ctrlKey, shiftPressed: event.shiftKey });
	}, { signal });
	window.addEventListener("keyup", (event) => {
		updateModifierKeyState({ modPressed: event.metaKey || event.ctrlKey, shiftPressed: event.shiftKey });
	}, { signal });
	window.addEventListener("blur", () => {
		updateModifierKeyState({ modPressed: false, shiftPressed: false });
	}, { signal });
}

function teardownShiftTracking(): void {
	shiftTrackingAbort?.abort();
	shiftTrackingAbort = null;
	updateModifierKeyState({ modPressed: false, shiftPressed: false });
}

function updateModifierKeyState(nextValue: { modPressed: boolean; shiftPressed: boolean }): void {
	if (shiftKeyPressed === nextValue.shiftPressed && modKeyPressed === nextValue.modPressed) {
		return;
	}

	shiftKeyPressed = nextValue.shiftPressed;
	modKeyPressed = nextValue.modPressed;
	modifierSubscribers.forEach((subscriber) => subscriber({ modPressed: modKeyPressed, shiftPressed: shiftKeyPressed }));
}

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
