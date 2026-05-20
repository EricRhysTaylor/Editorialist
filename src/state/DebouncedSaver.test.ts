import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DebouncedSaver } from "./DebouncedSaver";

describe("DebouncedSaver", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("coalesces multiple rapid requests into a single write", async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const saver = new DebouncedSaver(write, 300);

		void saver.request();
		void saver.request();
		void saver.request();

		expect(write).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(300);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it("resolves an awaited request after the write completes", async () => {
		let resolveWrite: (() => void) | null = null;
		const write = vi.fn(() => new Promise<void>((r) => { resolveWrite = r; }));
		const saver = new DebouncedSaver(write, 250);

		const pending = saver.request();
		let resolved = false;
		void pending.then(() => { resolved = true; });

		await vi.advanceTimersByTimeAsync(250);
		// write has been invoked but its promise has not yet resolved.
		expect(write).toHaveBeenCalledTimes(1);
		expect(resolved).toBe(false);

		resolveWrite?.();
		await pending;
		expect(resolved).toBe(true);
	});

	it("flush() writes pending request immediately, bypassing the timer", async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const saver = new DebouncedSaver(write, 1000);

		const pending = saver.request();
		expect(write).not.toHaveBeenCalled();

		await saver.flush();

		expect(write).toHaveBeenCalledTimes(1);
		await expect(pending).resolves.toBeUndefined();
	});

	it("flush() awaits an in-flight write when nothing is queued", async () => {
		let resolveWrite: (() => void) | null = null;
		const write = vi.fn(() => new Promise<void>((r) => { resolveWrite = r; }));
		const saver = new DebouncedSaver(write, 100);

		void saver.request();
		// Run the timer so the write actually starts.
		await vi.advanceTimersByTimeAsync(100);
		expect(write).toHaveBeenCalledTimes(1);

		let flushed = false;
		const flushPromise = saver.flush().then(() => { flushed = true; });

		// Until the in-flight write completes, flush should not resolve.
		await Promise.resolve();
		expect(flushed).toBe(false);

		resolveWrite?.();
		await flushPromise;
		expect(flushed).toBe(true);
		// No second write should have been triggered — the in-flight one was
		// sufficient.
		expect(write).toHaveBeenCalledTimes(1);
	});

	it("flush() is a no-op when nothing is pending or in-flight", async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const saver = new DebouncedSaver(write, 100);

		await saver.flush();
		expect(write).not.toHaveBeenCalled();
	});

	it("propagates write errors to every queued requester", async () => {
		const error = new Error("disk full");
		const write = vi.fn().mockRejectedValue(error);
		const saver = new DebouncedSaver(write, 100);

		// Convert each request promise into a settle-snapshot up front so
		// vitest does not flag the rejection as unhandled while we wait for
		// the timer to fire.
		const settled = await Promise.all([
			saver.request().then(() => "ok", (err: unknown) => err),
			saver.request().then(() => "ok", (err: unknown) => err),
			saver.request().then(() => "ok", (err: unknown) => err),
			vi.advanceTimersByTimeAsync(100).then(() => "advanced"),
		]);

		expect(settled[0]).toBe(error);
		expect(settled[1]).toBe(error);
		expect(settled[2]).toBe(error);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it("recovers cleanly: a request after a failed write still writes and resolves", async () => {
		const write = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("first fails"))
			.mockResolvedValueOnce(undefined);
		const saver = new DebouncedSaver(write, 100);

		const settledFirst = saver.request().then(() => "ok", (err: Error) => err.message);
		await vi.advanceTimersByTimeAsync(100);
		expect(await settledFirst).toBe("first fails");

		const r2 = saver.request();
		await vi.advanceTimersByTimeAsync(100);
		await expect(r2).resolves.toBeUndefined();
		expect(write).toHaveBeenCalledTimes(2);
	});

	it("a request arriving during an in-flight write triggers its own later write", async () => {
		let resolveFirst: (() => void) | null = null;
		const write = vi
			.fn<() => Promise<void>>()
			.mockImplementationOnce(() => new Promise<void>((r) => { resolveFirst = r; }))
			.mockResolvedValueOnce(undefined);
		const saver = new DebouncedSaver(write, 100);

		void saver.request();
		await vi.advanceTimersByTimeAsync(100);
		expect(write).toHaveBeenCalledTimes(1);

		// A second request arrives mid-flight; it must NOT fold into the
		// already-running write (which captured stale data) — it gets its own
		// future write.
		const r2 = saver.request();
		resolveFirst?.();
		await vi.advanceTimersByTimeAsync(100);
		await expect(r2).resolves.toBeUndefined();
		expect(write).toHaveBeenCalledTimes(2);
	});
});
