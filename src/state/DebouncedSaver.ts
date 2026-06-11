// Trailing-debounce wrapper for an async write operation. Multiple rapid
// request() calls inside the debounce window coalesce into a single write.
// Each request() returns a Promise that resolves only after the write that
// covers it actually completes (or rejects if that write throws), so callers
// can await durability without knowing about the debouncer.
//
// flush() cancels the pending timer and runs the write immediately, awaiting
// any in-flight write first. It is intended for plugin unload, where we must
// not drop a pending save.

export class DebouncedSaver {
	private timer: number | null = null;
	private pendingResolvers: Array<() => void> = [];
	private pendingRejectors: Array<(err: unknown) => void> = [];
	// writeChain tracks the most recent in-flight write so that flush() and
	// subsequent drains can serialize behind it. Errors are swallowed on the
	// chain itself (they were already delivered to the originating request()
	// rejectors); the chain only exists to order writes.
	private writeChain: Promise<void> = Promise.resolve();

	constructor(
		private readonly write: () => Promise<void>,
		private readonly delayMs: number,
	) {}

	request(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.pendingResolvers.push(resolve);
			this.pendingRejectors.push(reject);
			if (this.timer !== null) {
				window.clearTimeout(this.timer);
			}
			this.timer = window.setTimeout(() => {
				this.timer = null;
				// The drain promise itself may reject when the write throws,
				// but the originating request's rejector has already been
				// invoked inside drain(), so swallow the chain-level rejection
				// here to avoid an unhandled-promise warning.
				this.drain().catch(() => undefined);
			}, this.delayMs);
		});
	}

	async flush(): Promise<void> {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
			await this.drain();
			return;
		}
		// No pending request, but an in-flight write may still be running
		// (e.g., flush() called shortly after a drain started). Wait it out.
		await this.writeChain;
	}

	private drain(): Promise<void> {
		const resolvers = this.pendingResolvers;
		const rejectors = this.pendingRejectors;
		this.pendingResolvers = [];
		this.pendingRejectors = [];

		const chained = this.writeChain.then(async () => {
			try {
				await this.write();
				resolvers.forEach((resolve) => resolve());
			} catch (err) {
				rejectors.forEach((reject) => reject(err));
				throw err;
			}
		});
		this.writeChain = chained.catch(() => undefined);
		return chained;
	}
}
