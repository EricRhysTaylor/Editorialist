// Focused tests for the buildModalFooter primitive. Uses the lightweight
// ButtonComponent stub from tests/mocks/obsidian.ts (no DOM / no Obsidian
// runtime) and a tiny fake parent. These pin the behavior the three migrated
// PromiseModal children rely on: container class, button order, labels, CTA,
// per-button class, onClick wiring, and the syncDisabled() validation toggle
// (incl. the once-at-build-time call that reproduces the modals' trailing
// syncConfirmState/syncSaveState).

import { describe, it, expect, vi } from "vitest";
import type { ButtonComponent } from "obsidian";
import { buildModalFooter, type ModalFooterParent } from "./ModalFooter";

interface FakeDiv {
	cls: string;
}

function fakeParent() {
	const created: FakeDiv[] = [];
	const parent: ModalFooterParent = {
		createDiv: ({ cls }: { cls: string }) => {
			created.push({ cls });
			return {} as HTMLElement;
		},
	};
	return { parent, created };
}

// The mock ButtonComponent records text/cta/disabled/class/onClick.
type RecordedButton = ButtonComponent & {
	text: string;
	cta: boolean;
	disabled: boolean;
	clickHandler: (() => void) | null;
	classes: Set<string>;
};

describe("buildModalFooter", () => {
	it("creates the actions container with the caller's class", () => {
		const { parent, created } = fakeParent();
		buildModalFooter(parent, {
			className: "editorialist-choice-modal__actions",
			buttons: [{ text: "OK", onClick: () => {} }],
		});
		expect(created).toEqual([{ cls: "editorialist-choice-modal__actions" }]);
	});

	it("builds buttons in order with text, CTA, per-button class and onClick", () => {
		const { parent } = fakeParent();
		const confirm = vi.fn();
		const cancel = vi.fn();
		const footer = buildModalFooter(parent, {
			className: "editorialist-contributor-modal__actions",
			buttons: [
				{ text: "Save", cta: true, onClick: confirm },
				{ text: "Cancel", onClick: cancel },
			],
		});
		const [save, cancelBtn] = footer.buttons as RecordedButton[];
		expect(save.text).toBe("Save");
		expect(save.cta).toBe(true);
		expect(cancelBtn.text).toBe("Cancel");
		expect(cancelBtn.cta).toBe(false);

		save.clickHandler?.();
		cancelBtn.clickHandler?.();
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("applies a per-button class (choice-modal style buttons)", () => {
		const { parent } = fakeParent();
		const footer = buildModalFooter(parent, {
			className: "editorialist-choice-modal__actions",
			buttons: [
				{ text: "A", className: "editorialist-choice-modal__button", onClick: () => {} },
				{ text: "B", className: "editorialist-choice-modal__button", onClick: () => {} },
			],
		});
		for (const button of footer.buttons as RecordedButton[]) {
			expect(button.classes.has("editorialist-choice-modal__button")).toBe(true);
			expect(button.cta).toBe(false);
		}
	});

	it("disables a button at build time when enableWhen() is initially false", () => {
		const { parent } = fakeParent();
		let valid = false;
		const footer = buildModalFooter(parent, {
			className: "x",
			buttons: [
				{ text: "Confirm", cta: true, enableWhen: () => valid, onClick: () => {} },
				{ text: "Cancel", onClick: () => {} },
			],
		});
		const [confirm, cancel] = footer.buttons as RecordedButton[];
		// Initial sync ran inside buildModalFooter.
		expect(confirm.disabled).toBe(true);
		// A button with no enableWhen is never toggled.
		expect(cancel.disabled).toBe(false);

		valid = true;
		footer.syncDisabled();
		expect(confirm.disabled).toBe(false);

		valid = false;
		footer.syncDisabled();
		expect(confirm.disabled).toBe(true);
	});

	it("supports N value-buttons with no CTA/cancel (choice-modal shape)", () => {
		const { parent, created } = fakeParent();
		const picks: string[] = [];
		const footer = buildModalFooter(parent, {
			className: "editorialist-choice-modal__actions",
			buttons: ["open", "import", "cancel"].map((value) => ({
				text: value,
				className: "editorialist-choice-modal__button",
				onClick: () => picks.push(value),
			})),
		});
		expect(created).toHaveLength(1);
		expect(footer.buttons).toHaveLength(3);
		(footer.buttons as RecordedButton[]).forEach((b) => b.clickHandler?.());
		expect(picks).toEqual(["open", "import", "cancel"]);
	});
});
