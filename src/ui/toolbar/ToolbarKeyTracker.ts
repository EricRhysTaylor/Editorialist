// Instance-owned modifier-key tracker for the review toolbar. Replaces the
// module-level shift/mod/legend state that previously lived in Toolbar.ts.
// One tracker is owned per plugin instance; disposal is explicit and
// idempotent, so plugin unload (and hot-reload in dev) cannot leave window
// event listeners behind.
//
// Subscribers register a callback that fires once immediately with the
// current state, then again on every change. Subscribers can be added before
// or after the window listeners are armed — ensureTracking() is refcount-free
// on the subscriber side, listeners are armed on the first subscribe() and
// remain armed until the tracker is disposed (the previous module-level
// implementation refcounted teardown when subscribers reached zero, which
// produced churn during render cycles; for an instance-scoped tracker we keep
// listeners until dispose to avoid that churn).

export interface ToolbarModifierState {
	modPressed: boolean;
	shiftPressed: boolean;
}

export type ToolbarModifierSubscriber = (state: ToolbarModifierState) => void;

export class ToolbarKeyTracker {
	private shiftPressed = false;
	private modPressed = false;
	private legendOpen = false;
	private abort: AbortController | null = null;
	private readonly subscribers = new Set<ToolbarModifierSubscriber>();
	private disposed = false;

	getModifierState(): ToolbarModifierState {
		return { modPressed: this.modPressed, shiftPressed: this.shiftPressed };
	}

	isLegendOpen(): boolean {
		return this.legendOpen;
	}

	toggleLegendOpen(): boolean {
		this.legendOpen = !this.legendOpen;
		return this.legendOpen;
	}

	subscribe(callback: ToolbarModifierSubscriber): () => void {
		if (this.disposed) {
			// A late subscribe after dispose is a no-op — no state notification,
			// no listeners armed, the returned unsubscribe is harmless.
			return () => undefined;
		}
		this.ensureTracking();
		this.subscribers.add(callback);
		callback({ modPressed: this.modPressed, shiftPressed: this.shiftPressed });
		return () => {
			this.subscribers.delete(callback);
		};
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.subscribers.clear();
		this.abort?.abort();
		this.abort = null;
		// Reset modifier state so any future re-instantiation (hot reload)
		// starts from a clean slate. The tracker itself is not re-armable —
		// dispose is terminal.
		this.shiftPressed = false;
		this.modPressed = false;
	}

	private ensureTracking(): void {
		if (this.abort) {
			return;
		}
		this.abort = new AbortController();
		const { signal } = this.abort;
		window.addEventListener(
			"keydown",
			(event) => {
				this.updateModifierState({
					modPressed: event.metaKey || event.ctrlKey,
					shiftPressed: event.shiftKey,
				});
			},
			{ signal },
		);
		window.addEventListener(
			"keyup",
			(event) => {
				this.updateModifierState({
					modPressed: event.metaKey || event.ctrlKey,
					shiftPressed: event.shiftKey,
				});
			},
			{ signal },
		);
		window.addEventListener(
			"blur",
			() => {
				this.updateModifierState({ modPressed: false, shiftPressed: false });
			},
			{ signal },
		);
	}

	private updateModifierState(next: ToolbarModifierState): void {
		if (this.shiftPressed === next.shiftPressed && this.modPressed === next.modPressed) {
			return;
		}
		this.shiftPressed = next.shiftPressed;
		this.modPressed = next.modPressed;
		const snapshot: ToolbarModifierState = {
			modPressed: this.modPressed,
			shiftPressed: this.shiftPressed,
		};
		this.subscribers.forEach((subscriber) => subscriber(snapshot));
	}
}
