import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { PromiseModal } from "./PromiseModal";

class TestModal extends PromiseModal<string> {
	rendered = 0;
	cleaned = 0;

	protected renderContent(): void {
		this.rendered += 1;
	}

	protected onCleanup(): void {
		this.cleaned += 1;
	}

	deliver(value: string | null): void {
		this.finish(value);
	}
}

const app = {} as App;

describe("PromiseModal", () => {
	it("renders content when presented", async () => {
		const modal = new TestModal(app);
		const pending = modal.present();
		expect(modal.rendered).toBe(1);
		modal.deliver("done");
		await pending;
	});

	it("resolves once with the delivered value; the trailing close is ignored", async () => {
		const modal = new TestModal(app);
		const pending = modal.present();
		modal.deliver("chosen");
		await expect(pending).resolves.toBe("chosen");
	});

	it("resolves null when closed without a result (cancel)", async () => {
		const modal = new TestModal(app);
		const pending = modal.present();
		modal.close();
		await expect(pending).resolves.toBeNull();
	});

	it("an explicit finish(null) resolves null and is not overridden", async () => {
		const modal = new TestModal(app);
		const pending = modal.present();
		modal.deliver(null);
		await expect(pending).resolves.toBeNull();
	});

	it("repeated close() is safe and does not re-settle", async () => {
		const modal = new TestModal(app);
		const pending = modal.present();
		modal.deliver("first");
		modal.close();
		modal.close();
		await expect(pending).resolves.toBe("first");
	});

	it("runs the cleanup hook on close (both result and cancel paths)", async () => {
		const resolved = new TestModal(app);
		const r = resolved.present();
		resolved.deliver("x");
		await r;
		expect(resolved.cleaned).toBe(1);

		const cancelled = new TestModal(app);
		const c = cancelled.present();
		cancelled.close();
		await c;
		expect(cancelled.cleaned).toBe(1);
	});
});
