import { ButtonComponent, setIcon } from "obsidian";
import type EditorialistPlugin from "../main";

export interface ToolbarState {
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
	let isAlternateActive = false;
	let trackingDepth = 0;
	let modifierTracking: AbortController | null = null;
	let removalObserver: MutationObserver | null = null;
	if (alternateAction) {
		removalObserver = new MutationObserver(() => {
			if (!button.buttonEl.isConnected) {
				stopModifierTracking();
				removalObserver?.disconnect();
			}
		});
	}

	const applyPresentation = (useAlternate: boolean): void => {
		isAlternateActive = useAlternate;
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

	const stopModifierTracking = (): void => {
		modifierTracking?.abort();
		modifierTracking = null;
		syncModifierPresentation(false);
	};

	const startModifierTracking = (): void => {
		if (!alternateAction || modifierTracking) {
			return;
		}

		modifierTracking = new AbortController();
		const { signal } = modifierTracking;
		window.addEventListener("keydown", (event) => {
			syncModifierPresentation(event.shiftKey);
		}, { signal });
		window.addEventListener("keyup", (event) => {
			syncModifierPresentation(event.shiftKey);
		}, { signal });
		window.addEventListener("blur", () => {
			syncModifierPresentation(false);
		}, { signal });
	};

	const beginModifierAwareness = (): void => {
		trackingDepth += 1;
		if (trackingDepth === 1) {
			startModifierTracking();
		}
	};

	const endModifierAwareness = (): void => {
		trackingDepth = Math.max(0, trackingDepth - 1);
		if (trackingDepth === 0) {
			stopModifierTracking();
		}
	};

	button.buttonEl.addEventListener("pointerenter", beginModifierAwareness);
	button.buttonEl.addEventListener("pointerleave", endModifierAwareness);
	button.buttonEl.addEventListener("focus", beginModifierAwareness);
	button.buttonEl.addEventListener("blur", endModifierAwareness);
	removalObserver?.observe(document.body, {
		childList: true,
		subtree: true,
	});

	applyPresentation(false);
	bindImmediateAction(button.buttonEl, (event) => {
		if (alternateAction && event.shiftKey) {
			alternateAction.onClick();
			return;
		}

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
