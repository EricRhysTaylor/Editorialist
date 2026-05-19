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

import { ButtonComponent } from "obsidian";

export interface ModalFooterButtonSpec {
	text: string;
	cta?: boolean;
	className?: string;
	onClick: () => void;
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
		if (buttonSpec.className) {
			button.buttonEl.addClass(buttonSpec.className);
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
