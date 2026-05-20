// Shared modal footer primitive. Centralizes the "actions row + buttons +
// disabled-sync" boilerplate that EditorialistChoiceModal /
// ContributorReassignmentModal / ContributorStrengthsModal each re-hand-rolled
// verbatim (createDiv for the actions container, per-button
// ButtonComponent().setButtonText().setCta?().addClass?().onClick(), and the
// `button?.setDisabled(!valid)` validation toggle).
//
// Behavior is intentionally a 1:1 reproduction of the prior inline code:
//  - same container class (caller passes it, so per-modal class names are
//    preserved exactly),
//  - same button order, labels, CTA styling and per-button class,
//  - same onClick wiring,
//  - syncDisabled() reproduces the prior syncConfirmState/syncSaveState
//    `setDisabled(!predicate())` exactly, and is invoked once at build time
//    (matching the trailing sync call the modals made at end of render).
// No appearance or interaction change.

import { ButtonComponent, setIcon } from "obsidian";

export interface ModalFooterButtonSpec {
	text: string;
	cta?: boolean;
	// Single class or list of classes. Each is addClass'd individually so
	// callers that need a base class + modifier (e.g. "...__button" plus
	// "...__button--subtle") get both applied cleanly.
	className?: string | readonly string[];
	// Optional Lucide icon name prepended into the button. The icon span is
	// styled by `iconClassName` (or unclassed if omitted) so callers can
	// preserve their existing modal-specific icon CSS without forcing a
	// generic class on the primitive.
	icon?: string;
	iconClassName?: string;
	onClick: () => void;
	// Static, resolved-at-build-time disabled state. Useful when the caller
	// re-renders the modal on state changes (the next render rebuilds the
	// footer with a fresh `disabled` value). For reactive disable inside the
	// same render, prefer `enableWhen` + `syncDisabled()`.
	disabled?: boolean;
	// When provided, the button's disabled state is (re)derived from
	// `!enableWhen()` whenever syncDisabled() runs (and once at build time).
	enableWhen?: () => boolean;
}

export interface ModalFooterSpec {
	className: string;
	buttons: ModalFooterButtonSpec[];
}

export interface ModalFooter {
	buttons: ButtonComponent[];
	syncDisabled(): void;
}

// Minimal structural type for the container — real callers pass an Obsidian
// HTMLElement (which has createDiv); kept narrow so the primitive is testable
// without a DOM.
export interface ModalFooterParent {
	createDiv(options: { cls: string }): HTMLElement;
}

export function buildModalFooter(parent: ModalFooterParent, spec: ModalFooterSpec): ModalFooter {
	const actions = parent.createDiv({ cls: spec.className });
	const buttons = spec.buttons.map((buttonSpec) => {
		const button = new ButtonComponent(actions).setButtonText(buttonSpec.text);
		if (buttonSpec.cta) {
			button.setCta();
		}
		applyClassNames(button, buttonSpec.className);
		if (buttonSpec.icon) {
			const iconSpan = buttonSpec.iconClassName
				? button.buttonEl.createSpan({ cls: buttonSpec.iconClassName })
				: button.buttonEl.createSpan();
			button.buttonEl.prepend(iconSpan);
			setIcon(iconSpan, buttonSpec.icon);
		}
		if (buttonSpec.disabled !== undefined) {
			button.setDisabled(buttonSpec.disabled);
		}
		button.onClick(() => buttonSpec.onClick());
		return button;
	});

	const syncDisabled = (): void => {
		spec.buttons.forEach((buttonSpec, index) => {
			if (buttonSpec.enableWhen) {
				buttons[index]?.setDisabled(!buttonSpec.enableWhen());
			}
		});
	};
	syncDisabled();

	return { buttons, syncDisabled };
}

function applyClassNames(
	button: ButtonComponent,
	className: ModalFooterButtonSpec["className"],
): void {
	if (!className) {
		return;
	}
	if (typeof className === "string") {
		button.buttonEl.addClass(className);
		return;
	}
	for (const cls of className) {
		button.buttonEl.addClass(cls);
	}
}
