// Scene-inventory construction, extracted verbatim from
// ReviewRegistryService. Computes the per-note SceneReviewRecord set; the
// service still OWNS sceneReviewIndex / sweepRegistry / the decision index,
// performs the sameJsonValue change detection, the SweepRegistryManager
// reconciliation, field assignment, and all persistence + control flow
// (the `if (!session)` / `instanceof TFile` guards and the
// no-imported-blocks fallback to a full sync).
//
// All vault / ReviewEngine / decision-index / scope access is injected so
// this module stays free of Obsidian and of service state. Behavior —
// including the single shared `now` threaded into
// SweepRegistryManager.buildFromSceneInventory, the retire-stale loop, and
// the Pass-2 determinism / idempotency contract — is byte-identical.

import type { TFile } from "obsidian";
import { findImportedReviewBlocks } from "../../core/ReviewBlockFormat";
import { getSweepStatus, tallySuggestionStatuses } from "../../core/review/SweepCompletion";
import type { ReviewSession, ReviewSuggestion } from "../../models/ReviewSuggestion";
import type {
	PersistedReviewDecisionRecord,
	SceneReviewRecord,
} from "../../models/ContributorProfile";

export interface SceneInventoryBuilderDeps {
	getMarkdownFiles(): TFile[];
	resolveNoteText(file: TFile): Promise<string>;
	buildEngineSession(notePath: string, noteText: string): ReviewSession;
	applyPersistedReviewState(session: ReviewSession): ReviewSession;
	getPersistedDecisionRecord(
		notePath: string,
		suggestion: ReviewSuggestion,
	): PersistedReviewDecisionRecord | undefined;
	getSceneId(file: TFile): string | undefined;
	getBookHint(notePath: string): string | undefined;
	getSceneReviewIndex(): Record<string, SceneReviewRecord>;
	now?: () => number;
}

export interface FullInventoryResult {
	nextIndex: Record<string, SceneReviewRecord>;
	batchPresence: Map<string, Set<string>>;
	now: number;
}

export class SceneInventoryBuilder {
	private readonly now: () => number;

	constructor(private readonly deps: SceneInventoryBuilderDeps) {
		this.now = deps.now ?? (() => Date.now());
	}

	// Shared record construction — identical shape used by both the full
	// inventory loop and the single-session record path.
	private composeRecord(
		file: TFile,
		notePath: string,
		suggestions: readonly ReviewSuggestion[],
		batchIds: string[],
	): SceneReviewRecord {
		let lastDecisionAt = 0;
		for (const suggestion of suggestions) {
			const record = this.deps.getPersistedDecisionRecord(notePath, suggestion);
			if (record?.updatedAt) {
				lastDecisionAt = Math.max(lastDecisionAt, record.updatedAt);
			}
		}
		const tally = tallySuggestionStatuses(suggestions);

		return {
			sceneId: this.deps.getSceneId(file),
			notePath: file.path,
			noteTitle: file.basename,
			bookLabel: this.deps.getBookHint(file.path),
			batchIds,
			batchCount: batchIds.length,
			pendingCount: tally.pending,
			unresolvedCount: tally.unresolved,
			deferredCount: tally.deferred,
			acceptedCount: tally.accepted,
			rejectedCount: tally.rejected,
			rewrittenCount: tally.rewritten,
			status: getSweepStatus({
				pendingCount: tally.pending,
				unresolvedCount: tally.unresolved,
				deferredCount: tally.deferred,
			}),
			lastUpdated: Math.max(file.stat.mtime, lastDecisionAt),
		};
	}

	// Full vault rebuild. Returns the computed index + batch presence + the
	// single `now` the caller must thread into SweepRegistryManager so the
	// retire-stale records and the sweep build agree on the same clock.
	async buildFullInventory(): Promise<FullInventoryResult> {
		const nextIndex: Record<string, SceneReviewRecord> = {};
		const batchPresence = new Map<string, Set<string>>();
		const now = this.now();

		for (const file of this.deps.getMarkdownFiles()) {
			const noteText = await this.deps.resolveNoteText(file);
			const importedBlocks = findImportedReviewBlocks(noteText);
			if (importedBlocks.length === 0) {
				continue;
			}

			const batchIds = [
				...new Set(importedBlocks.map((block) => block.batchId).filter((value): value is string => Boolean(value))),
			];
			for (const batchId of batchIds) {
				const paths = batchPresence.get(batchId) ?? new Set<string>();
				paths.add(file.path);
				batchPresence.set(batchId, paths);
			}

			const session = this.deps.applyPersistedReviewState(
				this.deps.buildEngineSession(file.path, noteText),
			);
			nextIndex[file.path] = this.composeRecord(file, file.path, session.suggestions, batchIds);
		}

		for (const existing of Object.values(this.deps.getSceneReviewIndex())) {
			// Retire any prior record whose note no longer carries the batch. A note that
			// still holds blocks already has a fresh record in nextIndex. Do NOT keep a
			// stale record alive just because its sceneId now appears in another note —
			// that happens when a batch is moved between scenes (e.g. routed to the wrong
			// scene, then yanked into the right one) and would leave the review panel
			// permanently stuck on the abandoned scene.
			if (nextIndex[existing.notePath]) {
				continue;
			}

			nextIndex[existing.notePath] = {
				...existing,
				batchIds: [],
				batchCount: 0,
				pendingCount: 0,
				unresolvedCount: 0,
				deferredCount: 0,
				acceptedCount: 0,
				rejectedCount: 0,
				rewrittenCount: 0,
				status: "cleaned",
				cleanedAt: existing.cleanedAt ?? now,
				lastUpdated: existing.cleanedAt ?? now,
			};
		}

		return { nextIndex, batchPresence, now };
	}

	// Single-note record for an active session. Returns null when the note no
	// longer carries imported blocks — the caller falls back to a full sync
	// (preserving the prior control flow exactly).
	async buildSessionRecord(
		file: TFile,
		session: ReviewSession,
	): Promise<SceneReviewRecord | null> {
		const noteText = await this.deps.resolveNoteText(file);
		const importedBlocks = findImportedReviewBlocks(noteText);
		if (importedBlocks.length === 0) {
			return null;
		}

		const batchIds = [
			...new Set(importedBlocks.map((block) => block.batchId).filter((value): value is string => Boolean(value))),
		];
		return this.composeRecord(file, session.notePath, session.suggestions, batchIds);
	}
}
