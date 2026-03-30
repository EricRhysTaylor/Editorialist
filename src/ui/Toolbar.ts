import { ButtonComponent, setIcon } from "obsidian";
import type EditorialistPlugin from "../main";

let shiftKeyPressed = false;
let shiftTrackingAbort: AbortController | null = null;
const shiftSubscribers = new Set<(shiftPressed: boolean) => void>();

export interface ReviewToolbarState {
	mode: "review";
	canApply: boolean;
	canDefer: boolean;
	canNext: boolean;
	canPrevious: boolean;
	canReject: boolean;
	canUndoLastAccept: boolean;
	acceptedCount: number;
	completionLabel?: string;
	deferredCount: number;
	hasReviewBlock: boolean;
	operationLabel: string;
	pendingCount: number;
	rejectedCount: number;
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
	currentIndexLabel: string;
	title: string;
}

export interface AcceptedReviewToolbarState {
	mode: "accepted_review";
	currentIndexLabel: string;
	title: string;
}

export type ToolbarState =
	| ReviewToolbarState
	| HandoffToolbarState
	| PanelToolbarState
	| AppliedReviewToolbarState
	| AcceptedReviewToolbarState;

export function createReviewToolbarElement(
	plugin: EditorialistPlugin,
	state: ToolbarState,
): HTMLElement {
	const overlay = document.createElement("div");
	overlay.className = "editorialist-toolbar-overlay";
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

	if (state.mode === "applied_review") {
		toolbar.addClass("editorialist-toolbar--panel");
		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta" });
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
		buildButton(actions, "Exit", "x", () => {
			void plugin.exitAppliedReviewMode();
		}, false);
		return overlay;
	}

	if (state.mode === "accepted_review") {
		toolbar.addClass("editorialist-toolbar--panel");
		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta" });
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
		buildButton(actions, "Exit", "x", () => {
			void plugin.exitAcceptedReviewMode();
		}, false);
		return overlay;
	}

	const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta" });
	markAsNonEditorSurface(meta);
	renderMetaSegment(meta, state.operationLabel);
	renderMetaSeparator(meta);
	if (state.sceneProgressLabel) {
		renderMetaSegment(meta, state.sceneProgressLabel);
		renderMetaSeparator(meta);
	}
	renderMetaSegment(meta, state.selectedIndexLabel);
	renderMetaSeparator(meta);
	renderMetaSegment(meta, `${state.pendingCount} pending`);
	renderMetaSeparator(meta);
	renderMetaSegment(meta, `${state.unresolvedCount} unresolved`);
	if (state.deferredCount > 0) {
		renderMetaSeparator(meta);
		renderMetaSegment(meta, `${state.deferredCount} deferred`);
	}
	if (state.completionLabel) {
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.completionLabel, "editorialist-toolbar__meta-segment--positive");
	}
	if (state.acceptedCount > 0) {
		renderMetaSeparator(meta);
		renderMetaSegment(meta, `${state.acceptedCount} accepted`, "editorialist-toolbar__meta-segment--positive");
	}
	if (state.rejectedCount > 0) {
		renderMetaSeparator(meta);
		renderMetaSegment(meta, `${state.rejectedCount} rejected`, "editorialist-toolbar__meta-segment--negative");
	}

	const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
	buildButton(actions, "Previous", "arrow-left", () => {
		void plugin.selectPreviousSuggestion();
	}, !state.canPrevious);
	buildButton(actions, "Next", "arrow-right", () => {
		void plugin.selectNextSuggestion();
	}, !state.canNext);
	buildButton(
		actions,
		"Apply",
		"check",
		() => {
			void plugin.acceptSelectedSuggestion();
		},
		!state.canApply,
		true,
		{
			label: "Apply and advance",
			icon: "list-end",
			onClick: () => {
				void plugin.acceptSelectedSuggestionAndAdvance();
			},
		},
	);
	buildButton(actions, "Apply and review", "check-check", () => {
		void plugin.applyAndReviewSceneSuggestions();
	}, !plugin.canApplyAndReviewSceneSuggestions());
	buildButton(actions, "Defer", "clock", () => {
		plugin.deferSelectedSuggestion();
	}, !state.canDefer);
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

function buildButton(
	parent: HTMLElement,
	label: string,
	icon: string,
	onClick: () => void,
	disabled = false,
	isApply = false,
	alternateAction?: {
		label: string;
		icon: string;
		onClick: () => void;
	},
): void {
	const button = new ButtonComponent(parent).setTooltip(label);
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
	if (alternateAction) {
		removalObserver = new MutationObserver(() => {
			if (!button.buttonEl.isConnected) {
				unsubscribeShiftTracking?.();
				unsubscribeShiftTracking = null;
				removalObserver?.disconnect();
			}
		});
	}

	const applyPresentation = (useAlternate: boolean): void => {
		const nextLabel = useAlternate ? alternateAction?.label ?? label : label;
		const nextIcon = useAlternate ? alternateAction?.icon ?? icon : icon;
		button.setTooltip(nextLabel);
		button.buttonEl.setAttribute("aria-label", nextLabel);
		button.buttonEl.setAttribute("data-editorialist-shift-mode", useAlternate ? "true" : "false");
		setIcon(iconEl, nextIcon);
	};

	const syncModifierPresentation = (shiftPressed: boolean): void => {
		applyPresentation(Boolean(alternateAction) && shiftPressed);
	};

	if (alternateAction) {
		unsubscribeShiftTracking = subscribeToShiftKey(syncModifierPresentation);
	}
	removalObserver?.observe(document.body, {
		childList: true,
		subtree: true,
	});

	applyPresentation(Boolean(alternateAction) && shiftKeyPressed);
	bindImmediateAction(button.buttonEl, (event) => {
		if (alternateAction && event.shiftKey) {
			alternateAction.onClick();
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
	const button = new ButtonComponent(parent).setTooltip(label);
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

function subscribeToShiftKey(callback: (shiftPressed: boolean) => void): () => void {
	ensureShiftTracking();
	shiftSubscribers.add(callback);
	callback(shiftKeyPressed);
	return () => {
		shiftSubscribers.delete(callback);
		if (shiftSubscribers.size === 0) {
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
		updateShiftKeyState(event.shiftKey);
	}, { signal });
	window.addEventListener("keyup", (event) => {
		updateShiftKeyState(event.shiftKey);
	}, { signal });
	window.addEventListener("blur", () => {
		updateShiftKeyState(false);
	}, { signal });
}

function teardownShiftTracking(): void {
	shiftTrackingAbort?.abort();
	shiftTrackingAbort = null;
	updateShiftKeyState(false);
}

function updateShiftKeyState(nextValue: boolean): void {
	if (shiftKeyPressed === nextValue) {
		return;
	}

	shiftKeyPressed = nextValue;
	shiftSubscribers.forEach((subscriber) => subscriber(shiftKeyPressed));
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
