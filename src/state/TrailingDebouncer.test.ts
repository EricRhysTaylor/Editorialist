import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TrailingDebouncer } from "./TrailingDebouncer";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("TrailingDebouncer", () => {
	it("fires once after delayMs when scheduled once", () => {
		const fn = vi.fn();
		const d = new TrailingDebouncer(fn, 120);
		d.schedule();
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(119);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("coalesces a burst of schedule() calls into a single trailing fire", () => {
		const fn = vi.fn();
		const d = new TrailingDebouncer(fn, 120);
		for (let i = 0; i < 20; i++) {
			d.schedule();
			vi.advanceTimersByTime(10);
		}
		// After 200ms of repeated scheduling, the latest schedule reset the
		// timer; the handler has not fired yet.
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(120);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("flush() runs the handler immediately and clears the pending timer", () => {
		const fn = vi.fn();
		const d = new TrailingDebouncer(fn, 120);
		d.schedule();
		expect(d.isPending()).toBe(true);
		d.flush();
		expect(fn).toHaveBeenCalledTimes(1);
		expect(d.isPending()).toBe(false);
		// Advancing past the original delay must NOT re-fire.
		vi.advanceTimersByTime(1000);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("flush() is a no-op when nothing is scheduled", () => {
		const fn = vi.fn();
		const d = new TrailingDebouncer(fn, 120);
		d.flush();
		expect(fn).not.toHaveBeenCalled();
	});

	it("cancel() drops a pending fire without running the handler", () => {
		const fn = vi.fn();
		const d = new TrailingDebouncer(fn, 120);
		d.schedule();
		d.cancel();
		expect(d.isPending()).toBe(false);
		vi.advanceTimersByTime(1000);
		expect(fn).not.toHaveBeenCalled();
	});

	it("cancel() is a no-op when nothing is scheduled", () => {
		const fn = vi.fn();
		const d = new TrailingDebouncer(fn, 120);
		d.cancel();
		expect(fn).not.toHaveBeenCalled();
	});

	it("can be re-armed after firing", () => {
		const fn = vi.fn();
		const d = new TrailingDebouncer(fn, 50);
		d.schedule();
		vi.advanceTimersByTime(50);
		expect(fn).toHaveBeenCalledTimes(1);
		d.schedule();
		vi.advanceTimersByTime(50);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("can be re-armed after cancel()", () => {
		const fn = vi.fn();
		const d = new TrailingDebouncer(fn, 50);
		d.schedule();
		d.cancel();
		d.schedule();
		vi.advanceTimersByTime(50);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("handler invocation order is FIFO across two debouncers", () => {
		const calls: string[] = [];
		const a = new TrailingDebouncer(() => calls.push("a"), 50);
		const b = new TrailingDebouncer(() => calls.push("b"), 50);
		a.schedule();
		b.schedule();
		vi.advanceTimersByTime(50);
		expect(calls).toEqual(["a", "b"]);
	});
});
