// ToolbarKeyTracker exercises real window event listeners with
// AbortController-based teardown. The vitest config runs in node, so we stub
// `window` with a native EventTarget (Node 14.5+) — that supports
// addEventListener/removeEventListener AND the `{ signal }` option, which is
// exactly what the tracker uses. Events are synthesized with `new Event`
// plus property assignments because Node does not ship the DOM KeyboardEvent
// class as a global.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolbarKeyTracker } from "./ToolbarKeyTracker";

let fakeWindow: EventTarget;

function fireKey(type: "keydown" | "keyup", overrides: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}): void {
	const event = new Event(type);
	Object.assign(event, {
		metaKey: overrides.metaKey ?? false,
		ctrlKey: overrides.ctrlKey ?? false,
		shiftKey: overrides.shiftKey ?? false,
	});
	fakeWindow.dispatchEvent(event);
}

function fireBlur(): void {
	fakeWindow.dispatchEvent(new Event("blur"));
}

beforeEach(() => {
	fakeWindow = new EventTarget();
	vi.stubGlobal("window", fakeWindow);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ToolbarKeyTracker", () => {
	it("starts with no modifier pressed", () => {
		const tracker = new ToolbarKeyTracker();
		expect(tracker.getModifierState()).toEqual({ modPressed: false, shiftPressed: false });
	});

	it("keydown updates shift + mod state and notifies subscribers", () => {
		const tracker = new ToolbarKeyTracker();
		const notified: Array<{ modPressed: boolean; shiftPressed: boolean }> = [];
		tracker.subscribe((state) => {
			notified.push({ ...state });
		});
		// subscribe() fires once immediately with the initial state.
		expect(notified).toEqual([{ modPressed: false, shiftPressed: false }]);

		fireKey("keydown", { shiftKey: true });
		expect(tracker.getModifierState()).toEqual({ modPressed: false, shiftPressed: true });
		expect(notified[notified.length - 1]).toEqual({ modPressed: false, shiftPressed: true });

		fireKey("keydown", { metaKey: true, shiftKey: true });
		expect(tracker.getModifierState()).toEqual({ modPressed: true, shiftPressed: true });

		// ctrlKey also counts as mod.
		fireKey("keydown", { ctrlKey: true, shiftKey: true });
		expect(tracker.getModifierState()).toEqual({ modPressed: true, shiftPressed: true });
	});

	it("keyup clears the released modifier", () => {
		const tracker = new ToolbarKeyTracker();
		tracker.subscribe(() => undefined);
		fireKey("keydown", { metaKey: true, shiftKey: true });
		expect(tracker.getModifierState()).toEqual({ modPressed: true, shiftPressed: true });

		fireKey("keyup", { metaKey: false, shiftKey: true });
		expect(tracker.getModifierState()).toEqual({ modPressed: false, shiftPressed: true });

		fireKey("keyup", { metaKey: false, shiftKey: false });
		expect(tracker.getModifierState()).toEqual({ modPressed: false, shiftPressed: false });
	});

	it("blur clears all modifier state", () => {
		const tracker = new ToolbarKeyTracker();
		tracker.subscribe(() => undefined);
		fireKey("keydown", { metaKey: true, shiftKey: true });
		expect(tracker.getModifierState()).toEqual({ modPressed: true, shiftPressed: true });

		fireBlur();
		expect(tracker.getModifierState()).toEqual({ modPressed: false, shiftPressed: false });
	});

	it("does not notify subscribers when state did not change", () => {
		const tracker = new ToolbarKeyTracker();
		const callback = vi.fn();
		tracker.subscribe(callback);
		callback.mockClear();

		// Two keydowns with the same modifier state — only the first is a real
		// transition; the second must not fire the subscriber.
		fireKey("keydown", { shiftKey: true });
		fireKey("keydown", { shiftKey: true });
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("multiple subscribers all receive notifications", () => {
		const tracker = new ToolbarKeyTracker();
		const a = vi.fn();
		const b = vi.fn();
		tracker.subscribe(a);
		tracker.subscribe(b);
		a.mockClear();
		b.mockClear();

		fireKey("keydown", { shiftKey: true });
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
	});

	it("unsubscribe stops notifications for that callback only", () => {
		const tracker = new ToolbarKeyTracker();
		const a = vi.fn();
		const b = vi.fn();
		const unsubA = tracker.subscribe(a);
		tracker.subscribe(b);
		a.mockClear();
		b.mockClear();

		unsubA();
		fireKey("keydown", { shiftKey: true });
		expect(a).not.toHaveBeenCalled();
		expect(b).toHaveBeenCalledTimes(1);
	});

	describe("dispose lifecycle", () => {
		it("dispose removes window listeners so subsequent events do not update state or notify", () => {
			const tracker = new ToolbarKeyTracker();
			const callback = vi.fn();
			tracker.subscribe(callback);
			fireKey("keydown", { shiftKey: true });
			expect(tracker.getModifierState().shiftPressed).toBe(true);
			callback.mockClear();

			tracker.dispose();
			// Modifier state resets to false on dispose.
			expect(tracker.getModifierState()).toEqual({ modPressed: false, shiftPressed: false });

			// Events after dispose are dropped — listener was removed via
			// AbortController, so the tracker neither updates state nor notifies.
			fireKey("keydown", { metaKey: true, shiftKey: true });
			expect(tracker.getModifierState()).toEqual({ modPressed: false, shiftPressed: false });
			expect(callback).not.toHaveBeenCalled();
		});

		it("dispose is idempotent (double-dispose is safe)", () => {
			const tracker = new ToolbarKeyTracker();
			tracker.subscribe(() => undefined);
			tracker.dispose();
			expect(() => tracker.dispose()).not.toThrow();
			// State stays clean.
			expect(tracker.getModifierState()).toEqual({ modPressed: false, shiftPressed: false });
		});

		it("subscribe after dispose is a no-op that does not arm listeners", () => {
			const tracker = new ToolbarKeyTracker();
			tracker.dispose();
			const callback = vi.fn();
			const unsubscribe = tracker.subscribe(callback);
			// Subscribe-after-dispose returns a no-op unsubscriber; the callback
			// must not fire on the initial snapshot, and must not be armed.
			expect(callback).not.toHaveBeenCalled();
			fireKey("keydown", { shiftKey: true });
			expect(callback).not.toHaveBeenCalled();
			expect(() => unsubscribe()).not.toThrow();
		});
	});

	describe("hot-reload (fresh-instance) hygiene", () => {
		it("a new instance does not inherit the previous instance's modifier state", () => {
			const first = new ToolbarKeyTracker();
			first.subscribe(() => undefined);
			fireKey("keydown", { metaKey: true, shiftKey: true });
			expect(first.getModifierState()).toEqual({ modPressed: true, shiftPressed: true });
			first.dispose();

			const second = new ToolbarKeyTracker();
			expect(second.getModifierState()).toEqual({ modPressed: false, shiftPressed: false });
		});

		it("after disposing the previous instance, a new instance receives fresh window events", () => {
			const first = new ToolbarKeyTracker();
			const firstCb = vi.fn();
			first.subscribe(firstCb);
			first.dispose();
			firstCb.mockClear();

			const second = new ToolbarKeyTracker();
			const secondCb = vi.fn();
			second.subscribe(secondCb);
			secondCb.mockClear();

			fireKey("keydown", { shiftKey: true });
			expect(firstCb).not.toHaveBeenCalled();
			expect(secondCb).toHaveBeenCalledTimes(1);
			expect(second.getModifierState()).toEqual({ modPressed: false, shiftPressed: true });
		});
	});
});
