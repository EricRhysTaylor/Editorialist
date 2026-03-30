import type { ReviewSweepRegistryEntry } from "../models/ReviewImport";
import type { ReviewStore } from "../state/ReviewStore";
import type { ReviewRegistryService } from "./ReviewRegistryService";

interface ReviewWorkflowHost {
	clearReviewSelection: () => Promise<void>;
	cleanupBatchById: (batchId: string) => Promise<void>;
	enterCompletedSweepAudit: () => Promise<void>;
	notify: (message: string) => void;
	openNoteForReview: (filePath: string) => Promise<void>;
}

export class ReviewWorkflowService {
	private transitionInProgress = false;

	constructor(
		private readonly store: ReviewStore,
		private readonly registry: ReviewRegistryService,
		private readonly host: ReviewWorkflowHost,
	) {}

	isTransitioning(): boolean {
		return this.transitionInProgress;
	}

	getCurrentBatchId(noteText?: string): string | null {
		return this.registry.resolveCurrentBatchId(this.store.getGuidedSweep()?.batchId ?? null, noteText ?? "");
	}

	async syncCurrentNote(notePath: string): Promise<void> {
		const guidedSweep = this.store.getGuidedSweep();
		if (!guidedSweep) {
			return;
		}

		const currentNoteIndex = guidedSweep.notePaths.findIndex((candidate) => candidate === notePath);
		if (currentNoteIndex === -1) {
			return;
		}

		this.store.updateGuidedSweepCurrentNote(notePath);
		await this.registry.updateSweepRegistry(
			guidedSweep.batchId,
			{
				currentNotePath: notePath,
			},
			{ persist: true },
		);
	}

	async cleanupCurrentBatch(noteText?: string): Promise<boolean> {
		const batchId = this.getCurrentBatchId(noteText);
		if (!batchId) {
			return false;
		}

		await this.host.cleanupBatchById(batchId);
		return true;
	}

	async openExistingSweep(entry: ReviewSweepRegistryEntry): Promise<void> {
		const notePaths = entry.sceneOrder.length > 0 ? entry.sceneOrder : entry.importedNotePaths;
		const targetPath = entry.currentNotePath ?? notePaths[0];
		if (!targetPath) {
			return;
		}

		this.store.setGuidedSweep({
			batchId: entry.batchId,
			currentNoteIndex: Math.max(0, notePaths.findIndex((path) => path === targetPath)),
			notePaths,
			startedAt: entry.importedAt,
		});

		await this.openSweepNote(targetPath);
	}

	async startGuidedSweep(batchId: string, importedAt: number, notePaths: string[]): Promise<void> {
		const [firstNotePath] = notePaths;
		if (!firstNotePath) {
			return;
		}

		this.store.setGuidedSweep({
			batchId,
			currentNoteIndex: 0,
			notePaths,
			startedAt: importedAt,
		});
		await this.registry.updateSweepRegistry(batchId, {
			currentNotePath: firstNotePath,
			sceneOrder: notePaths,
			status: "in_progress",
		});
		await this.openSweepNote(firstNotePath);
	}

	async advanceGuidedSweep(): Promise<void> {
		const guidedSweep = this.store.getGuidedSweep();
		if (!guidedSweep) {
			await this.host.clearReviewSelection();
			return;
		}

		const nextNotePath = guidedSweep.notePaths[guidedSweep.currentNoteIndex + 1];
		if (!nextNotePath) {
			await this.finishGuidedSweep();
			return;
		}

		await this.registry.updateSweepRegistry(guidedSweep.batchId, {
			currentNotePath: nextNotePath,
			status: "in_progress",
		});
		this.store.setGuidedSweep({
			...guidedSweep,
			currentNoteIndex: guidedSweep.currentNoteIndex + 1,
		});
		await this.openSweepNote(nextNotePath);
	}

	async finishGuidedSweep(): Promise<void> {
		const guidedSweep = this.store.getGuidedSweep();
		if (!guidedSweep) {
			return;
		}

		const entry = this.registry.getSweepRegistryEntry(guidedSweep.batchId);
		await this.registry.updateSweepRegistry(guidedSweep.batchId, {
			status: "completed",
		});
		this.store.setCompletedSweep({
			batchId: guidedSweep.batchId,
			completedAt: Date.now(),
			currentNoteIndex: guidedSweep.currentNoteIndex,
			notePaths: [...guidedSweep.notePaths],
			startedAt: guidedSweep.startedAt,
			totalSuggestions: entry?.totalSuggestions ?? 0,
		});
		this.store.setGuidedSweep(null);
		await this.host.enterCompletedSweepAudit();
		this.host.notify("Guided sweep complete.");
	}

	private async openSweepNote(filePath: string): Promise<void> {
		this.transitionInProgress = true;
		try {
			await this.host.openNoteForReview(filePath);
		} finally {
			this.transitionInProgress = false;
		}
	}
}
