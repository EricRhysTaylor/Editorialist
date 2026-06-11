// Owns review-batch orchestration: clipboard load + inspect, duplicate-sweep
// detection, importing a batch (into routed notes or the active note),
// recording the imported batch, and the cleanup / reset paths. Extracted
// verbatim from EditorialistPlugin (main.ts) — notices, ordering, async
// behavior and error handling are byte-identical; main.ts is now only the
// composition root that instantiates this processor and delegates.
//
// The processor knows nothing about the plugin internals: every collaborator
// it needs (note contexts, the import engine, registry/workflow/store
// operations, persistence + refresh) is reached through the narrow
// ReviewBatchProcessorHost it is constructed with.

import { Notice, TFile, type App, type MarkdownView } from "obsidian";
import {
	REVIEW_BLOCK_FENCE,
	getReviewBlockFenceLabel,
	normalizeImportedReviewText,
	removeImportedReviewBlocks,
} from "../core/ReviewBlockFormat";
import { openEditorialistChoiceModal } from "../ui/EditorialistChoiceModal";
import type { ClipboardReviewBatch } from "../ui/EditorialistModal";
import type { ImportEngine } from "../core/ImportEngine";
import type {
	ReviewImportBatch,
	ReviewImportNoteGroup,
	ReviewSweepRegistryEntry,
	ReviewSweepStatus,
} from "../models/ReviewImport";
import type { SceneReviewRecord } from "../models/ContributorProfile";
import type { CompletedSweepState, GuidedSweepState } from "../state/ReviewStore";

export interface BatchNoteContext {
	filePath: string;
	text: string;
	view: MarkdownView;
}

export interface ReviewBatchProcessorHost {
	readonly app: App;
	getImportEngine(): ImportEngine;
	getActiveNoteContext(): BatchNoteContext | null;
	getReviewNoteContext(): BatchNoteContext | null;
	getNoteContextByPath(filePath: string): BatchNoteContext | null;
	getResolvedCompletedSweepState(): CompletedSweepState | null;
	getGuidedSweep(): GuidedSweepState | null;
	setGuidedSweep(value: GuidedSweepState | null): void;
	persistContributorProfilesIfNeeded(): Promise<void>;
	savePluginData(): Promise<void>;
	resyncSessionForActiveNote(): void;
	refreshReviewPanel(): void;
	// registry
	findDuplicateSweep(batch: ReviewImportBatch): ReviewSweepRegistryEntry | null;
	recordImportedBatch(
		batch: ReviewImportBatch,
		importedGroups: ReviewImportNoteGroup[],
		status: ReviewSweepStatus,
		currentNotePath?: string,
	): Promise<void>;
	getSweepRegistryEntry(batchId?: string): ReviewSweepRegistryEntry | null;
	updateSweepRegistry(
		batchId: string,
		updates: Partial<ReviewSweepRegistryEntry>,
		options?: { persist?: boolean },
	): Promise<void>;
	syncSceneInventory(): Promise<void>;
	getSceneReviewRecords(): SceneReviewRecord[];
	resetBatchHistoryInRegistry(
		batchId: string,
	): Promise<{ removedDecisions: number; removedSignals: number; removedSweep: boolean }>;
	// workflow
	openExistingSweep(entry: ReviewSweepRegistryEntry): Promise<void>;
	startGuidedSweep(batchId: string, importedAt: number, notePaths: string[]): Promise<void>;
	cleanupCurrentBatch(noteText?: string): Promise<boolean>;
}

export class ReviewBatchProcessor {
	constructor(private readonly host: ReviewBatchProcessorHost) {}

	async loadClipboardReviewBatch(): Promise<ClipboardReviewBatch | null> {
		if (!navigator.clipboard?.readText) {
			return null;
		}

		try {
			const rawText = await navigator.clipboard.readText();
			const normalizedText = normalizeImportedReviewText(rawText);
			if (!normalizedText) {
				return null;
			}

			const context = this.host.getActiveNoteContext();
			const batch = await this.host.getImportEngine().inspectBatch(normalizedText, {
				activeNotePath: context?.filePath,
			});
			await this.host.persistContributorProfilesIfNeeded();
			if (batch.summary.totalSuggestions === 0) {
				return null;
			}

			return {
				rawText: normalizedText,
				batch,
			};
		} catch {
			return null;
		}
	}

	async importReviewBatch(batch: ReviewImportBatch, startReview: boolean): Promise<void> {
		const duplicateSweep = this.host.findDuplicateSweep(batch);
		if (duplicateSweep) {
			const choice = await openEditorialistChoiceModal(this.host.app, {
				title: "Possible existing review batch detected",
				description: "This review batch appears to match an existing imported sweep. Open it, import again, or cancel.",
				choices: [
					{ label: "Open existing sweep", value: "open" },
					{ label: "Import anyway", value: "import" },
					{ label: "Cancel", value: "cancel" },
				],
			});
			if (choice === "open") {
				await this.host.openExistingSweep(duplicateSweep);
			}
			if (choice !== "import") {
				return;
			}
		}

		const importedGroups = await this.host.getImportEngine().importBatch(batch);
		if (importedGroups.length === 0) {
			new Notice("No review blocks were imported.");
			return;
		}

		await this.host.recordImportedBatch(batch, importedGroups, "in_progress");

		if (!startReview) {
			new Notice(
				`Imported ${importedGroups.reduce((count, group) => count + group.suggestions.length, 0)} suggestions into ${importedGroups.length} note${importedGroups.length === 1 ? "" : "s"}.`,
			);
		}

		if (!startReview) {
			return;
		}

		await this.host.startGuidedSweep(
			batch.batchId,
			batch.createdAt,
			importedGroups.map((group) => group.filePath),
		);
	}

	async importReviewBatchToActiveNote(rawText: string, startReview: boolean): Promise<void> {
		const context = this.host.getActiveNoteContext();
		if (!context) {
			new Notice("No active Markdown note to import into.");
			return;
		}

		const normalizedText = normalizeImportedReviewText(rawText);
		if (!normalizedText) {
			new Notice(`No ${getReviewBlockFenceLabel()} found in the imported text.`);
			return;
		}

		const batch = await this.inspectReviewBatch(rawText, { activeNotePath: context.filePath });
		const duplicateSweep = this.host.findDuplicateSweep(batch);
		if (duplicateSweep) {
			const choice = await openEditorialistChoiceModal(this.host.app, {
				title: "Possible existing review batch detected",
				description: "This review batch appears to match an existing imported sweep. Open it, import again, or cancel.",
				choices: [
					{ label: "Open existing sweep", value: "open" },
					{ label: "Import anyway", value: "import" },
					{ label: "Cancel", value: "cancel" },
				],
			});
			if (choice === "open") {
				await this.host.openExistingSweep(duplicateSweep);
			}
			if (choice !== "import") {
				return;
			}
		}

		const batchText = this.addImportedBlockMetadata(normalizedText, batch.batchId);

		const currentText = context.view.editor.getValue();
		const trimmedCurrentText = currentText.trimEnd();
		const trimmedBatch = batchText.trim();
		const separator = trimmedCurrentText.length > 0 ? "\n\n" : "";
		const nextText = `${trimmedCurrentText}${separator}${trimmedBatch}\n`;
		context.view.editor.setValue(nextText);
		await this.host.recordImportedBatch(
			batch,
			[
				{
					filePath: context.filePath,
					fileName: context.view.file?.basename ?? context.filePath,
					sceneId: undefined,
					suggestions: batch.results,
					memos: [],
					exactCount: batch.summary.totalExactMatches,
					declaredCount: batch.summary.totalDeclaredRoutes,
					inferredCount: batch.summary.totalInferredRoutes,
					exactInferredCount: batch.results.filter(
						(result) => result.routeStrategy === "inferred_exact" && result.verificationStatus === "exact",
					).length,
					advisoryCount: batch.summary.totalAdvisoryOnly,
					unresolvedCount: batch.summary.totalUnresolvedMatches,
					mismatchCount: batch.summary.totalMismatches,
					isReady: true,
				},
			],
			"in_progress",
			context.filePath,
		);

		if (startReview) {
			await this.host.startGuidedSweep(batch.batchId, batch.createdAt, [context.filePath]);
			return;
		}

		new Notice("Imported review block into the active note.");
	}

	private addImportedBlockMetadata(blockText: string, batchId: string): string {
		if (blockText.includes(`BatchId: ${batchId}`)) {
			return blockText;
		}

		return blockText.replace(
			new RegExp(`^\\\`\\\`\\\`${REVIEW_BLOCK_FENCE}\\s*$`, "m"),
			(match) => `${match}\nBatchId: ${batchId}\nImportedBy: Editorialist`,
		);
	}

	async inspectReviewBatch(
		rawText: string,
		options?: Parameters<ImportEngine["inspectBatch"]>[1],
	): Promise<ReviewImportBatch> {
		const batch = await this.host.getImportEngine().inspectBatch(rawText, options);
		await this.host.persistContributorProfilesIfNeeded();
		return batch;
	}

	// Aggregates per-suggestion decisions across scenes that participated in a
	// given sweep batch. Exact when each touched scene has only seen this one
	// batch (the common case); approximate when scenes are shared across
	// batches — in that case counts are the union, which is acceptable for the
	// at-a-glance Recent Reviews display.
	getBatchDecisionStats(batchId: string): {
		accepted: number;
		rejected: number;
		rewritten: number;
		deferred: number;
	} {
		// Prefer the frozen snapshot on the registry entry. It tracks counts live
		// while the batch is in_progress / completed and preserves them after the
		// batch is cleaned, so historical Recent Reviews entries keep their stats.
		const entry = this.host.getSweepRegistryEntry(batchId);
		if (entry) {
			return {
				accepted: entry.acceptedCount ?? 0,
				rejected: entry.rejectedCount ?? 0,
				rewritten: entry.rewrittenCount ?? 0,
				deferred: entry.deferredCount ?? 0,
			};
		}

		const records = this.host.getSceneReviewRecords();
		let accepted = 0;
		let rejected = 0;
		let rewritten = 0;
		let deferred = 0;
		for (const record of records) {
			if (!record.batchIds.includes(batchId)) {
				continue;
			}
			accepted += record.acceptedCount;
			rejected += record.rejectedCount;
			rewritten += record.rewrittenCount;
			deferred += record.deferredCount;
		}
		return { accepted, rejected, rewritten, deferred };
	}

	async resetBatchHistory(
		batchId: string,
	): Promise<{ removedDecisions: number; removedSignals: number; removedSweep: boolean }> {
		const result = await this.host.resetBatchHistoryInRegistry(batchId);
		await this.host.savePluginData();
		this.host.resyncSessionForActiveNote();
		this.host.refreshReviewPanel();
		return result;
	}

	async cleanupCurrentReviewBatch(): Promise<void> {
		const context = this.host.getReviewNoteContext() ?? this.host.getActiveNoteContext();
		if (!(await this.host.cleanupCurrentBatch(context?.text))) {
			new Notice("No imported review batch is active.");
		}
	}

	async cleanupReviewBatchById(batchId: string): Promise<void> {
		await this.cleanupReviewBatch(batchId);
	}

	async cleanupCompletedSweepReviewBlocks(): Promise<void> {
		const completedSweep = this.host.getResolvedCompletedSweepState();
		if (!completedSweep) {
			new Notice("No completed revision pass is available to clean.");
			return;
		}

		// Cleanup deletes the review-block fences from the notes. After that
		// the audit view ("Review changes") has no data to render, since
		// suggestion prose only lives inside those fences (the persisted
		// decision index stores status only). Warn the user before destroying
		// that affordance.
		const choice = await openEditorialistChoiceModal(this.host.app, {
			title: "Clean review blocks?",
			description:
				"This removes the imported review blocks from your notes. After cleanup you will no longer be able to walk through this pass with \"Review changes\" — the audit data only lives inside those blocks.",
			choices: [
				{ label: "Clean review blocks", value: "confirm" },
				{ label: "Cancel", value: "cancel" },
			],
		});
		if (choice !== "confirm") {
			return;
		}

		await this.cleanupReviewBatch(completedSweep.batchId);
	}

	async removeImportedReviewBlocksInCurrentNote(): Promise<void> {
		const context = this.host.getActiveNoteContext();
		if (!context) {
			new Notice("No active Markdown note.");
			return;
		}

		const removed = removeImportedReviewBlocks(context.view.editor.getValue());
		if (removed.removedCount === 0) {
			new Notice("No imported Editorialist review blocks found in this note.");
			return;
		}

		context.view.editor.setValue(removed.text);
		await this.host.syncSceneInventory();
		this.host.resyncSessionForActiveNote();
		new Notice(`Removed ${removed.removedCount} imported review block${removed.removedCount === 1 ? "" : "s"} from this note.`);
	}

	async cleanupReviewBatch(batchId: string): Promise<void> {
		const entry = this.host.getSweepRegistryEntry(batchId);
		if (!entry) {
			new Notice("Review batch registry entry not found.");
			return;
		}

		let removedCount = 0;
		for (const notePath of entry.importedNotePaths) {
			const context = this.host.getNoteContextByPath(notePath);
			if (context) {
				const removed = removeImportedReviewBlocks(context.view.editor.getValue(), batchId);
				if (removed.removedCount > 0) {
					context.view.editor.setValue(removed.text);
					removedCount += removed.removedCount;
				}
				continue;
			}

			const file = this.host.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) {
				continue;
			}

			let currentRemovedCount = 0;
			await this.host.app.vault.process(file, (currentText) => {
				const removed = removeImportedReviewBlocks(currentText, batchId);
				currentRemovedCount = removed.removedCount;
				return removed.removedCount > 0 ? removed.text : currentText;
			});
			removedCount += currentRemovedCount;
		}

		await this.host.updateSweepRegistry(
			batchId,
			{
				status: "cleaned",
				cleanedAt: Date.now(),
			},
			{ persist: false },
		);
		if (this.host.getGuidedSweep()?.batchId === batchId) {
			this.host.setGuidedSweep(null);
		}
		await this.host.syncSceneInventory();
		this.host.resyncSessionForActiveNote();
		new Notice(
			removedCount > 0
				? `Cleaned ${removedCount} imported review block${removedCount === 1 ? "" : "s"}.`
				: "No imported review blocks were found for this batch.",
		);
	}
}
