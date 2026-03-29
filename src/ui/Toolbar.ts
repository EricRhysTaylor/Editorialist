import { ButtonComponent, setIcon } from "obsidian";
import type EditorialistPlugin from "../main";

export interface ToolbarState {
	canApply: boolean;
	canLater: boolean;
	canNext: boolean;
	canPrevious: boolean;
	canReject: boolean;
	completionLabel?: string;
	hasReviewBlock: boolean;
	operationLabel: string;
	pendingCount: number;
	resolvedCount: number;
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
	if (state.completionLabel) {
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.completionLabel, "editorialist-toolbar__meta-segment--resolved");
	}
	if (state.resolvedCount > 0) {
		renderMetaSeparator(meta);
		renderMetaSegment(meta, `${state.resolvedCount} resolved`, "editorialist-toolbar__meta-segment--resolved");
	}

	const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
	buildButton(actions, "Previous", "arrow-left", () => {
		void plugin.selectPreviousSuggestion();
	}, !state.canPrevious);
	buildButton(actions, "Next", "arrow-right", () => {
		void plugin.selectNextSuggestion();
	}, !state.canNext);
	buildButton(actions, "Apply", "check", () => {
		void plugin.acceptSelectedSuggestion();
	}, !state.canApply, true);
	buildButton(actions, "Later", "clock", () => {
		plugin.laterSelectedSuggestion();
	}, !state.canLater);
	buildButton(actions, "Reject", "x", () => {
		void plugin.rejectSelectedSuggestion();
	}, !state.canReject);

	return overlay;
}

function buildButton(
	parent: HTMLElement,
	label: string,
	icon: string,
	onClick: () => void,
	disabled = false,
	isApply = false,
): void {
	const button = new ButtonComponent(parent).setTooltip(label);
	button.setDisabled(disabled);
	button.buttonEl.addClass("editorialist-toolbar__button");
	if (isApply) {
		button.buttonEl.addClass("editorialist-toolbar__button--apply");
	}
	markAsNonEditorSurface(button.buttonEl);
	button.buttonEl.setAttribute("aria-label", label);
	const iconEl = button.buttonEl.createSpan({ cls: "editorialist-toolbar__button-icon" });
	markAsNonEditorSurface(iconEl);
	setIcon(iconEl, icon);
	bindImmediateAction(button.buttonEl, onClick);
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

function bindImmediateAction(element: HTMLElement, onClick: () => void): void {
	let handledPointerDown = false;

	element.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) {
			return;
		}

		handledPointerDown = true;
		event.preventDefault();
		event.stopPropagation();
		onClick();
	});

	element.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (handledPointerDown) {
			handledPointerDown = false;
			return;
		}

		onClick();
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
