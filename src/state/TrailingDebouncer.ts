// Minimal trailing-edge debouncer for cheap, non-async UI/event handlers.
//
// Distinct from DebouncedSaver (sibling): that one serializes async writes
// and surfaces per-request promises. This one is a one-shot fire-and-forget
// scheduler — every schedule() resets a single in-flight timer and runs the
// handler synchronously when the timer fires. Intended for resync-style
// handlers that absorb bursts of editor-change events without observably
// degrading correctness.
//
// Lifecycle:
//   - schedule() — (re)arm the timer; previous pending fire is dropped.
//   - flush()    — if a fire is pending, run it now and clear the timer.
//   - cancel()   — if a fire is pending, drop it without running.
//
// On plugin unload, prefer cancel() (the host is going away; running a
// resync against torn-down state is pointless and risks accessing stale
// references). flush() is provided for symmetry with DebouncedSaver and for
// future consumers that need terminal execution.

export class TrailingDebouncer {
	private timer: number | null = null;

	constructor(
		private readonly handler: () => void,
		private readonly delayMs: number,
	) {}

	schedule(): void {
		this.cancel();
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.handler();
		}, this.delayMs);
	}

	flush(): void {
		if (this.timer === null) {
			return;
		}
		window.clearTimeout(this.timer);
		this.timer = null;
		this.handler();
	}

	cancel(): void {
		if (this.timer === null) {
			return;
		}
		window.clearTimeout(this.timer);
		this.timer = null;
	}

	// Inspection helper for tests; production code should not rely on this.
	isPending(): boolean {
		return this.timer !== null;
	}
}
