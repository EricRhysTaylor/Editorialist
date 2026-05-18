import { Modal, type App } from "obsidian";

// Shared base for modals that resolve a single value (or null on cancel).
// Centralizes the resolve-once latch and the "close => cancel with null"
// convention that EditorialistChoiceModal / ContributorReassignmentModal /
// ContributorStrengthsModal each re-implemented verbatim.
//
// Contract (unchanged from the prior hand-rolled versions):
//  - present() opens the modal and returns a Promise.
//  - finish(value) delivers a result and closes; the close-driven cancel that
//    follows is ignored (resolve-once).
//  - Any other close (Esc, click-away, programmatic close()) resolves null.
//  - contentEl is emptied before renderContent() and again on close.
export abstract class PromiseModal<T> extends Modal {
	private settled = false;
	private resolver: ((value: T | null) => void) | null = null;

	constructor(app: App) {
		super(app);
	}

	// Subclasses build their UI here; contentEl is already empty.
	protected abstract renderContent(): void;

	// Optional teardown hook (timers, observers) run on close, before the
	// pending result settles to null.
	protected onCleanup(): void {}

	// Deliver a concrete result (or explicit null) and close.
	protected finish(value: T | null): void {
		this.settle(value);
		this.close();
	}

	onOpen(): void {
		this.contentEl.empty();
		this.renderContent();
	}

	onClose(): void {
		this.contentEl.empty();
		this.onCleanup();
		this.settle(null);
	}

	present(): Promise<T | null> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	private settle(value: T | null): void {
		if (this.settled) {
			return;
		}
		this.settled = true;
		const resolver = this.resolver;
		this.resolver = null;
		resolver?.(value);
	}
}
