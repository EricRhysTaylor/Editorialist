// Focused tests for ToolbarOverlayController. The controller has NO Obsidian
// dependency — only DOM globals (window.requestAnimationFrame) plus the
// element's ownerDocument and plain types — so it is testable with tiny
// stubs and no jsdom / no Obsidian mock. These lock the extraction's critical invariants:
//   - position updates are rAF-deduped (one frame for N schedule calls)
//   - destroy() cancels the pending frame and detaches the element
//   - the dismissal signature gates rebuild until mode/selection changes
//   - non-overlay states tear the overlay down instead of rendering it

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ToolbarOverlayController } from "./ToolbarOverlayController";
import type { ToolbarState } from "../ui/Toolbar";

function fakeEditorView() {
	return {
		scrollDOM: {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, bottom: 200 }),
		},
		coordsAtPos: () => ({ top: 50, bottom: 60 }),
	} as never;
}

function fakeToolbarEl() {
	const el = {
		firstElementChild: { getBoundingClientRect: () => ({ height: 30 }) },
		classList: { toggle: vi.fn() },
		style: { setProperty: vi.fn() },
		ownerDocument: { body: { appendChild: () => { appended += 1; } } },
		removed: 0,
		remove() {
			this.removed += 1;
		},
	};
	return el as unknown as HTMLElement & { removed: number };
}

let rafCallbacks: Array<() => void>;
let rafCalls: number;
let cancelCalls: number;
let appended: number;

beforeEach(() => {
	rafCallbacks = [];
	rafCalls = 0;
	cancelCalls = 0;
	appended = 0;
	vi.stubGlobal("window", {
		requestAnimationFrame: (cb: () => void) => {
			rafCalls += 1;
			rafCallbacks.push(cb);
			return rafCalls;
		},
		cancelAnimationFrame: () => {
			cancelCalls += 1;
		},
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function makeController(selectedId: string | null = null) {
	let lastEl: (HTMLElement & { removed: number }) | null = null;
	const controller = new ToolbarOverlayController({
		getActiveHighlightRange: () => null,
		getSelectedSuggestionId: () => selectedId,
		createToolbarElement: () => {
			lastEl = fakeToolbarEl();
			return lastEl;
		},
	});
	return { controller, getEl: () => lastEl };
}

const panel = { mode: "panel" } as ToolbarState;

describe("ToolbarOverlayController", () => {
	it("renders for an overlay state and rAF-dedupes position updates", () => {
		const { controller, getEl } = makeController();
		controller.sync(fakeEditorView(), panel, null);
		expect(appended).toBe(1);
		// sync() scheduled one frame; extra schedule calls coalesce.
		controller.scheduleReposition();
		controller.scheduleReposition();
		expect(rafCalls).toBe(1);
		// Run the frame, then a fresh schedule allocates the next frame.
		rafCallbacks[0]?.();
		controller.scheduleReposition();
		expect(rafCalls).toBe(2);
		expect(getEl()).not.toBeNull();
	});

	it("destroy() cancels the pending frame and detaches the element", () => {
		const { controller, getEl } = makeController();
		controller.sync(fakeEditorView(), panel, null);
		const el = getEl();
		controller.destroy();
		expect(cancelCalls).toBe(1);
		expect(el?.removed).toBe(1);
	});

	it("a non-overlay / missing-editor state tears the overlay down", () => {
		const { controller } = makeController();
		controller.sync(null, panel, null);
		expect(appended).toBe(0);
		controller.sync(fakeEditorView(), { mode: "review" } as ToolbarState, null);
		expect(appended).toBe(0); // review with no highlight -> not shown
	});

	it("dismiss() suppresses rebuild until mode/selection changes", () => {
		let selected: string | null = "s1";
		const controller = new ToolbarOverlayController({
			getActiveHighlightRange: () => null,
			getSelectedSuggestionId: () => selected,
			createToolbarElement: () => fakeToolbarEl(),
		});
		controller.sync(fakeEditorView(), panel, null);
		expect(appended).toBe(1);

		controller.dismiss(); // freezes signature "panel:s1"
		controller.sync(fakeEditorView(), panel, null);
		expect(appended).toBe(1); // same signature -> stays dismissed

		selected = "s2"; // selection changed -> signature differs
		controller.sync(fakeEditorView(), panel, null);
		expect(appended).toBe(2);
	});

	it("clearDismissedSignature() re-enables rendering immediately", () => {
		const { controller } = makeController("s1");
		controller.sync(fakeEditorView(), panel, null);
		controller.dismiss();
		controller.clearDismissedSignature();
		controller.sync(fakeEditorView(), panel, null);
		expect(appended).toBe(2);
	});

	it("handleResize() measures and schedules without throwing when idle", () => {
		const { controller } = makeController();
		expect(() => controller.handleResize()).not.toThrow();
		expect(rafCalls).toBe(1);
	});
});
