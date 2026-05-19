import { TFile, type App } from "obsidian";
import { findImportedReviewBlocks } from "../core/ReviewBlockFormat";
import type { ReviewEngine } from "../core/ReviewEngine";
import {
	getBookHintForPath,
	getSceneIdForFile,
	isPathInFolderScope,
	readRadialTimelineActiveBookScope,
	type ActiveBookScopeInfo,
	getFrontmatterStringValues,
} from "../core/VaultScope";
import type {
	EditorialistMetadataExport,
	ReviewImportBatch,
	ReviewImportNoteGroup,
	ReviewSweepRegistryEntry,
	ReviewSweepStatus,
} from "../models/ReviewImport";
import type { ReviewSession, ReviewSuggestion } from "../models/ReviewSuggestion";
import type {
	EditorialistPluginData,
	PersistedReviewDecisionRecord,
	ContributorProfile,
	ReviewerSignalRecord,
	SceneReviewRecord,
} from "../models/ContributorProfile";
import type { ContributorDirectory } from "../state/ContributorDirectory";
import { getLegacyContributorSignatureKind } from "../core/ContributorIdentity";
import { getSuggestionSignatureParts } from "../core/OperationSupport";
import { ReviewerStatsProjector } from "./registry/ReviewerStatsProjector";
import {
	normalizeReviewDecisionIndex,
	normalizeReviewerSignalIndex,
	normalizeSceneReviewIndex,
	normalizeSweepRegistry,
} from "./registry/ReviewRegistryNormalization";
import { SweepRegistryManager } from "./registry/SweepRegistryManager";
import { SceneInventoryBuilder } from "./registry/SceneInventoryBuilder";
import { tallyReviewStatuses } from "../core/review/SweepCompletion";

interface ReviewActivitySummary {
	accepted: number;
	cleanedSweeps: number;
	completedSweeps: number;
	deferred: number;
	inProgressSweeps: number;
	pending: number;
	processed: number;
	rejected: number;
	rewritten: number;
	totalSuggestions: number;
	totalSweeps: number;
	unresolved: number;
}

interface TrackingIdentitySummary {
	editorialIdCount: number;
	genericFrontmatterIdCount: number;
	missingCount: number;
	mode: "editorial-note-ids" | "frontmatter-ids" | "path-fallback" | "radial-timeline";
	rtSceneIdCount: number;
	trackedCount: number;
}

export class ReviewRegistryService {
	private activeBookScope: ActiveBookScopeInfo = {
		label: null,
		sourceFolder: null,
	};
	private reviewDecisionIndex: Record<string, PersistedReviewDecisionRecord> = {};
	private reviewerSignalIndex: Record<string, ReviewerSignalRecord> = {};
	private sceneReviewIndex: Record<string, SceneReviewRecord> = {};
	private sweepRegistry: Record<string, ReviewSweepRegistryEntry> = {};
	private readonly statsProjector: ReviewerStatsProjector;
	private readonly sweepManager: SweepRegistryManager;
	private readonly inventoryBuilder: SceneInventoryBuilder;

	constructor(
		private readonly app: App,
		private readonly reviewEngine: ReviewEngine,
		private readonly reviewerDirectory: ContributorDirectory,
		private readonly persistData: () => Promise<void>,
	) {
		this.statsProjector = new ReviewerStatsProjector(this.reviewerDirectory);
		this.sweepManager = new SweepRegistryManager({
			getSceneReviewIndex: () => this.sceneReviewIndex,
			getActiveBookScope: () => this.activeBookScope,
		});
		this.inventoryBuilder = new SceneInventoryBuilder({
			getMarkdownFiles: () => this.app.vault.getMarkdownFiles(),
			resolveNoteText: async (file) =>
				this.getOpenNoteText(file.path) ?? (await this.app.vault.cachedRead(file)),
			buildEngineSession: (notePath, noteText) =>
				this.reviewEngine.buildSession(notePath, noteText, null),
			applyPersistedReviewState: (session) => this.applyPersistedReviewState(session),
			getPersistedDecisionRecord: (notePath, suggestion) =>
				this.getPersistedReviewDecisionRecord(notePath, suggestion),
			getSceneId: (file) => getSceneIdForFile(this.app, file),
			getBookHint: (notePath) => getBookHintForPath(notePath, this.activeBookScope),
			getSceneReviewIndex: () => this.sceneReviewIndex,
		});
	}

	load(savedData: Partial<EditorialistPluginData> | null): void {
		this.reviewDecisionIndex = normalizeReviewDecisionIndex(savedData?.reviewDecisionIndex);
		this.reviewerSignalIndex = normalizeReviewerSignalIndex(savedData?.reviewerSignalIndex);
		this.sceneReviewIndex = normalizeSceneReviewIndex(savedData?.sceneReviewIndex);
		this.sweepRegistry = normalizeSweepRegistry(savedData?.sweepRegistry);
	}

	rebuildReviewerStatsFromSignals(): void {
		this.statsProjector.rebuildFromSignals(this.reviewerSignalIndex);
	}

	buildPluginData(reviewerProfiles: ContributorProfile[]): EditorialistPluginData {
		return {
			reviewerProfiles,
			reviewerSignalIndex: this.reviewerSignalIndex,
			reviewDecisionIndex: this.reviewDecisionIndex,
			sceneReviewIndex: this.sceneReviewIndex,
			sweepRegistry: this.sweepRegistry,
		};
	}

	getActiveBookScopeInfo(): ActiveBookScopeInfo {
		return {
			...this.activeBookScope,
		};
	}

	usesSceneTerminology(notePath?: string): boolean {
		if (notePath) {
			return this.isSceneClassNote(notePath);
		}

		return Boolean(this.activeBookScope.sourceFolder);
	}

	isRadialTimelineScene(notePath: string): boolean {
		if (!this.activeBookScope.sourceFolder) {
			return false;
		}

		return this.isSceneClassNote(notePath) && isPathInFolderScope(notePath, this.activeBookScope.sourceFolder);
	}

	getSweepRegistryEntries(): ReviewSweepRegistryEntry[] {
		return this.sweepManager.getEntries(this.sweepRegistry);
	}

	getSweepRegistryEntry(batchId?: string): ReviewSweepRegistryEntry | null {
		return this.sweepManager.getEntry(this.sweepRegistry, batchId);
	}

	getSceneReviewRecords(options?: { activeBookOnly?: boolean }): SceneReviewRecord[] {
		const records = Object.values(this.sceneReviewIndex).sort((left, right) => {
			if (left.status !== right.status) {
				return this.getSceneReviewStatusRank(left.status) - this.getSceneReviewStatusRank(right.status);
			}

			return right.lastUpdated - left.lastUpdated;
		});

		if (options?.activeBookOnly && this.activeBookScope.sourceFolder) {
			return records.filter((record) => isPathInFolderScope(record.notePath, this.activeBookScope.sourceFolder as string));
		}

		return records;
	}

	getTrackingIdentitySummary(options?: { activeBookOnly?: boolean }): TrackingIdentitySummary {
		const records = this.getSceneReviewRecords(options).filter((record) => record.status !== "cleaned");
		let editorialIdCount = 0;
		let genericFrontmatterIdCount = 0;
		let rtSceneIdCount = 0;
		let missingCount = 0;

		for (const record of records) {
			const file = this.app.vault.getAbstractFileByPath(record.notePath);
			if (!(file instanceof TFile)) {
				missingCount += 1;
				continue;
			}

			const frontmatter =
				this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
			const editorialIds = getFrontmatterStringValues(frontmatter, [
				"editorial_id",
				"editorialId",
				"EditorialId",
			]);
			const rtIds = getFrontmatterStringValues(frontmatter, [
				"id",
				"Id",
				"ID",
				"sceneid",
				"sceneId",
				"SceneId",
				"scene_id",
				"Scene_ID",
			]);

			if (editorialIds.length > 0) {
				editorialIdCount += 1;
				continue;
			}

			if (rtIds.length > 0) {
				if (this.isRadialTimelineScene(record.notePath)) {
					rtSceneIdCount += 1;
				} else {
					genericFrontmatterIdCount += 1;
				}
				continue;
			}

			missingCount += 1;
		}

		if (rtSceneIdCount > 0 && missingCount === 0 && genericFrontmatterIdCount === 0 && editorialIdCount === 0) {
			return {
				trackedCount: records.length,
				rtSceneIdCount,
				editorialIdCount,
				genericFrontmatterIdCount,
				missingCount,
				mode: "radial-timeline",
			};
		}

		if (editorialIdCount > 0 && missingCount === 0 && genericFrontmatterIdCount === 0 && rtSceneIdCount === 0) {
			return {
				trackedCount: records.length,
				rtSceneIdCount,
				editorialIdCount,
				genericFrontmatterIdCount,
				missingCount,
				mode: "editorial-note-ids",
			};
		}

		if (genericFrontmatterIdCount > 0 && missingCount === 0 && editorialIdCount === 0 && rtSceneIdCount === 0) {
			return {
				trackedCount: records.length,
				rtSceneIdCount,
				editorialIdCount,
				genericFrontmatterIdCount,
				missingCount,
				mode: "frontmatter-ids",
			};
		}

		return {
			trackedCount: records.length,
			rtSceneIdCount,
			editorialIdCount,
			genericFrontmatterIdCount,
			missingCount,
			mode: "path-fallback",
		};
	}

	getReviewActivitySummary(_reviewerProfiles: ContributorProfile[]): ReviewActivitySummary {
		const signalTotals = tallyReviewStatuses(
			Object.values(this.reviewerSignalIndex).map((profile) => profile.status),
		);
		const entries = this.getSweepRegistryEntries();

		return {
			...signalTotals,
			processed: signalTotals.accepted + signalTotals.rejected + signalTotals.rewritten,
			totalSweeps: entries.length,
			inProgressSweeps: entries.filter((entry) => entry.status === "in_progress").length,
			completedSweeps: entries.filter((entry) => entry.status === "completed").length,
			cleanedSweeps: entries.filter((entry) => entry.status === "cleaned").length,
		};
	}

	// Resume detection for the import/Begin flow. Only an `in_progress` sweep is
	// genuinely resumable; a `completed` sweep is finished work (offering to
	// "open" it made completed work look resumable) and a `cleaned` sweep no
	// longer has blocks. Re-importing identical content whose sweep is already
	// completed therefore starts a fresh pass instead of reopening the old one.
	findDuplicateSweep(batch: ReviewImportBatch): ReviewSweepRegistryEntry | null {
		return this.sweepManager.findDuplicate(this.sweepRegistry, batch);
	}

	applyPersistedReviewState(session: ReviewSession): ReviewSession {
		return {
			...session,
			suggestions: session.suggestions.map((suggestion) => {
				const record = this.getPersistedReviewDecisionRecord(session.notePath, suggestion);
				if (!record) {
					return suggestion;
				}

				return {
					...suggestion,
					status: record.status,
				};
			}),
		};
	}

	async persistReviewDecision(
		notePath: string,
		suggestion: ReviewSuggestion,
		status: PersistedReviewDecisionRecord["status"],
		options?: { persist?: boolean; sessionId?: string; sessionStartedAt?: number },
	): Promise<void> {
		const keys = this.createPersistedReviewDecisionKeys(notePath, suggestion);
		const key = keys[0];
		if (!key) {
			return;
		}
		const existing = keys
			.map((candidate) => this.reviewDecisionIndex[candidate])
			.find((record): record is PersistedReviewDecisionRecord => Boolean(record));
		if (existing?.status === status) {
			if (existing.key !== key) {
				delete this.reviewDecisionIndex[existing.key];
				this.reviewDecisionIndex[key] = {
					...existing,
					key,
				};
				if (options?.persist !== false) {
					await this.persistData();
				}
			}
			return;
		}

		for (const candidate of keys) {
			if (candidate !== key) {
				delete this.reviewDecisionIndex[candidate];
			}
		}

		this.reviewDecisionIndex[key] = {
			key,
			status,
			updatedAt: Date.now(),
			sessionId: options?.sessionId,
			sessionStartedAt: options?.sessionStartedAt,
		};
		if (options?.persist !== false) {
			await this.persistData();
		}
	}

	async clearPersistedReviewDecision(
		notePath: string,
		suggestion: ReviewSuggestion,
		options?: { persist?: boolean },
	): Promise<void> {
		const keys = this.createPersistedReviewDecisionKeys(notePath, suggestion);
		let removed = false;
		for (const key of keys) {
			if (!this.reviewDecisionIndex[key]) {
				continue;
			}

			delete this.reviewDecisionIndex[key];
			removed = true;
		}

		if (!removed) {
			return;
		}
		if (options?.persist !== false) {
			await this.persistData();
		}
	}

	async syncReviewerSignalsForSession(
		session: ReviewSession | null,
		options?: { persist?: boolean; sessionId?: string; sessionStartedAt?: number },
	): Promise<void> {
		if (!session) {
			return;
		}

		const { nextIndex, didChange } = this.statsProjector.reconcileSession(
			this.reviewerSignalIndex,
			session,
			(notePath) => this.getNoteIdentityKeys(notePath),
			{ sessionId: options?.sessionId, sessionStartedAt: options?.sessionStartedAt },
		);

		if (didChange) {
			this.reviewerSignalIndex = nextIndex;
			if (options?.persist !== false) {
				await this.persistData();
			}
		}
	}

	async reassignReviewerSignals(
		sourceReviewerId: string,
		targetReviewerId: string,
		options?: { persist?: boolean },
	): Promise<void> {
		if (!sourceReviewerId || !targetReviewerId || sourceReviewerId === targetReviewerId) {
			return;
		}

		let didChange = false;
		for (const record of Object.values(this.reviewerSignalIndex)) {
			if (record.reviewerId !== sourceReviewerId) {
				continue;
			}

			record.reviewerId = targetReviewerId;
			didChange = true;
		}

		if (!didChange) {
			return;
		}

		if (options?.persist !== false) {
			await this.persistData();
		}
	}

	async refreshActiveBookScope(): Promise<void> {
		this.activeBookScope = await readRadialTimelineActiveBookScope(this.app);
	}

	async syncOperationalMetadata(): Promise<void> {
		await this.refreshActiveBookScope();
		await this.syncSceneInventory();
	}

	async syncSceneInventory(options?: { persist?: boolean }): Promise<void> {
		const { nextIndex, batchPresence, now } = await this.inventoryBuilder.buildFullInventory();

		const nextRegistry = this.sweepManager.buildFromSceneInventory(this.sweepRegistry, batchPresence, nextIndex, now);
		const inventoryChanged = !this.sameJsonValue(this.sceneReviewIndex, nextIndex);
		const registryChanged = !this.sameJsonValue(this.sweepRegistry, nextRegistry);
		if (!inventoryChanged && !registryChanged) {
			return;
		}

		this.sceneReviewIndex = nextIndex;
		this.sweepRegistry = nextRegistry;
		if (options?.persist !== false) {
			await this.persistData();
		}
	}

	async syncSceneInventoryForSession(
		session: ReviewSession | null,
		options?: { persist?: boolean },
	): Promise<void> {
		if (!session) {
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(session.notePath);
		if (!(file instanceof TFile)) {
			return;
		}

		const nextRecord = await this.inventoryBuilder.buildSessionRecord(file, session);
		if (nextRecord === null) {
			await this.syncSceneInventory(options);
			return;
		}

		if (this.sameJsonValue(this.sceneReviewIndex[session.notePath], nextRecord)) {
			return;
		}

		this.sceneReviewIndex = {
			...this.sceneReviewIndex,
			[session.notePath]: nextRecord,
		};

		this.sweepManager.reconcileStatus(this.sweepRegistry, nextRecord);

		if (options?.persist !== false) {
			await this.persistData();
		}
	}

	// Registry-level completeness for a single sweep, used by the guided-sweep
	// finish guard.
	isSweepRegistryComplete(batchId: string): boolean {
		return this.sweepManager.isComplete(this.sweepRegistry, batchId);
	}

	async recordImportedBatch(
		batch: ReviewImportBatch,
		importedGroups: ReviewImportNoteGroup[],
		status: ReviewSweepStatus,
		currentNotePath?: string,
	): Promise<void> {
		this.sweepManager.recordImportedBatch(this.sweepRegistry, batch, importedGroups, status, currentNotePath);
		await this.syncSceneInventory();
	}

	async updateSweepRegistry(
		batchId: string,
		updates: Partial<ReviewSweepRegistryEntry>,
		options?: { persist?: boolean },
	): Promise<void> {
		const changed = this.sweepManager.updateEntry(this.sweepRegistry, batchId, updates);
		if (!changed) {
			return;
		}

		if (options?.persist !== false) {
			await this.persistData();
		}
	}

	// Stamps an active-book scene's frontmatter with a "sweep close" marker:
	//   Editorialist:
	//     revision: <N>           — incremented each completed sweep pass
	//     revision_updated: <ISO> — millisecond-precision timestamp
	//
	// Counts distinct sweep passes that *closed* on a scene with all suggestions
	// resolved — not visits, not edits, not interactions. The four gates below
	// (RT scene, sweep-complete, inside guided sweep, not already bumped this
	// batch) all enforce that strict semantic.
	//
	// Currently the only consumer is the "Sweeps" column in the Settings scene
	// inventory. The shape was scaffolded for richer workflows that haven't
	// shipped: "edited since last sweep" detection (compare revision_updated
	// against file mtime), default-skip already-polished scenes in the next
	// sweep, per-revision archive/diff, and a Radial Timeline polish-state
	// overlay. The data shape supports those as-is.
	async incrementSceneEditorialRevision(
		notePath: string,
		batchId?: string,
	): Promise<{ from: number; to: number } | null> {
		// Gate 1: must be a scene-class note inside the active book scope.
		if (!this.isRadialTimelineScene(notePath)) {
			return null;
		}

		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return null;
		}

		// Gate 2: dedupe within a batch. Re-entering the same scene during the
		// same sweep should not double-bump the counter.
		const entry = batchId ? this.getSweepRegistryEntry(batchId) : null;
		if (batchId && entry?.editorialRevisionUpdatedNotePaths?.includes(notePath)) {
			return null;
		}

		const fileManager = this.app.fileManager as App["fileManager"] & {
			processFrontMatter?: (
				file: TFile,
				fn: (frontmatter: Record<string, unknown>) => void,
			) => Promise<void>;
		};
		if (!fileManager.processFrontMatter) {
			return null;
		}

		let from = 0;
		let to = 0;
		await fileManager.processFrontMatter(file, (frontmatter) => {
			const readBlock = (key: string): Record<string, unknown> | null => {
				const value = frontmatter[key];
				return value && typeof value === "object" && !Array.isArray(value)
					? (value as Record<string, unknown>)
					: null;
			};
			// Read from the canonical key first; fall back to the legacy lower-case
			// `editorial:` key so vaults predating the rename keep their counter.
			const existing = readBlock("Editorialist") ?? readBlock("editorial") ?? {};
			const currentRevision = Number(existing.revision);
			from = Number.isFinite(currentRevision) ? currentRevision : 0;
			to = from + 1;
			frontmatter.Editorialist = {
				...existing,
				revision: to,
				revision_updated: new Date().toISOString(),
			};
			if ("editorial" in frontmatter) {
				delete frontmatter.editorial;
			}
		});

		if (batchId) {
			const updatedNotePaths = [...new Set([...(entry?.editorialRevisionUpdatedNotePaths ?? []), notePath])];
			await this.updateSweepRegistry(batchId, {
				editorialRevisionUpdatedNotePaths: updatedNotePaths,
			});
		}

		return { from, to };
	}

	async clearCleanedSweepRecords(): Promise<number> {
		return 0;
	}

	async injectStableNoteIds(notePaths: string[]): Promise<number> {
		const fileManager = this.app.fileManager as App["fileManager"] & {
			processFrontMatter?: (
				file: TFile,
				fn: (frontmatter: Record<string, unknown>) => void,
			) => Promise<void>;
		};
		if (!fileManager.processFrontMatter) {
			return 0;
		}

		let injectedCount = 0;
		for (const notePath of new Set(notePaths)) {
			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) {
				continue;
			}

			if (getSceneIdForFile(this.app, file)) {
				continue;
			}

			await fileManager.processFrontMatter(file, (frontmatter) => {
				const existingId = getFrontmatterStringValues(frontmatter, [
					"id",
					"Id",
					"ID",
					"editorial_id",
					"editorialId",
					"EditorialId",
					"sceneid",
					"sceneId",
					"SceneId",
					"scene_id",
					"Scene_ID",
				])[0];
				if (existingId?.trim()) {
					return;
				}

				frontmatter.editorial_id = this.createEditorialNoteId();
				injectedCount += 1;
			});
		}

		if (injectedCount > 0) {
			await this.syncOperationalMetadata();
		}

		return injectedCount;
	}

	async resetBatchHistory(batchId: string): Promise<{ removedDecisions: number; removedSignals: number; removedSweep: boolean }> {
		let removedDecisions = 0;
		let removedSignals = 0;

		for (const [key, record] of Object.entries(this.reviewDecisionIndex)) {
			if (record.sessionId !== batchId) {
				continue;
			}

			delete this.reviewDecisionIndex[key];
			removedDecisions += 1;
		}

		for (const [key, record] of Object.entries(this.reviewerSignalIndex)) {
			if (record.sessionId !== batchId) {
				continue;
			}

			delete this.reviewerSignalIndex[key];
			removedSignals += 1;
		}

		const removedSweep = Boolean(this.sweepRegistry[batchId]);
		delete this.sweepRegistry[batchId];
		this.rebuildReviewerStatsFromSignals();
		await this.syncSceneInventory();

		return {
			removedDecisions,
			removedSignals,
			removedSweep,
		};
	}

	async resetAllRevisionHistory(): Promise<{ removedDecisions: number; removedSignals: number; removedSweeps: number }> {
		const removedDecisions = Object.keys(this.reviewDecisionIndex).length;
		const removedSignals = Object.keys(this.reviewerSignalIndex).length;
		const removedSweeps = Object.keys(this.sweepRegistry).length;

		this.reviewDecisionIndex = {};
		this.reviewerSignalIndex = {};
		this.sceneReviewIndex = {};
		this.sweepRegistry = {};
		this.rebuildReviewerStatsFromSignals();
		await this.syncSceneInventory();

		return {
			removedDecisions,
			removedSignals,
			removedSweeps,
		};
	}

	async removeReviewerSignalsByReviewerId(reviewerId: string, options?: { persist?: boolean }): Promise<number> {
		let removedCount = 0;
		for (const [key, record] of Object.entries(this.reviewerSignalIndex)) {
			if (record.reviewerId !== reviewerId) {
				continue;
			}

			delete this.reviewerSignalIndex[key];
			removedCount += 1;
		}

		if (removedCount > 0) {
			this.rebuildReviewerStatsFromSignals();
			if (options?.persist !== false) {
				await this.persistData();
			}
		}

		return removedCount;
	}

	async clearAllReviewerSignals(options?: { persist?: boolean }): Promise<number> {
		const removedCount = Object.keys(this.reviewerSignalIndex).length;
		if (removedCount === 0) {
			return 0;
		}

		this.reviewerSignalIndex = {};
		this.rebuildReviewerStatsFromSignals();
		if (options?.persist !== false) {
			await this.persistData();
		}

		return removedCount;
	}

	buildMetadataExport(reviewerProfiles: ContributorProfile[]): EditorialistMetadataExport {
		return {
			schemaVersion: "2.0.0",
			exportedAt: Date.now(),
			contributors: reviewerProfiles.map((profile) => ({
				createdAt: profile.createdAt,
				displayName: profile.displayName,
				id: profile.id,
				kind: profile.kind,
				reviewerType: profile.reviewerType,
				aliases: [...profile.aliases],
				strengths: profile.strengths ? [...profile.strengths] : undefined,
				isStarred: profile.isStarred,
				model: profile.model,
				provider: profile.provider,
				stats: profile.stats ? { ...profile.stats } : undefined,
				updatedAt: profile.updatedAt,
			})),
			scenes: this.getSceneReviewRecords().map((record) => ({
				...record,
				batchIds: [...record.batchIds],
			})),
			sweeps: this.getSweepRegistryEntries().map((entry) => ({
				...entry,
				importedNotePaths: [...entry.importedNotePaths],
				sceneOrder: [...entry.sceneOrder],
			})),
		};
	}

	resolveCurrentBatchId(guidedSweepBatchId: string | null, noteText: string): string | null {
		if (guidedSweepBatchId) {
			return guidedSweepBatchId;
		}

		return findImportedReviewBlocks(noteText)[0]?.batchId ?? null;
	}

	private createPersistedReviewDecisionKeys(notePath: string, suggestion: ReviewSuggestion): string[] {
		const keys: string[] = [];
		for (const noteIdentity of this.getNoteIdentityKeys(notePath)) {
			keys.push(
				[
					noteIdentity,
					suggestion.operation,
					suggestion.executionMode,
					suggestion.contributor.raw.rawName ?? "",
					suggestion.contributor.raw.rawType ?? "",
					suggestion.contributor.raw.rawProvider ?? "",
					suggestion.contributor.raw.rawModel ?? "",
					...getSuggestionSignatureParts(suggestion),
					suggestion.why ?? "",
				].join("::"),
			);
			keys.push(
				[
					noteIdentity,
					suggestion.operation,
					suggestion.executionMode,
					suggestion.contributor.displayName,
					getLegacyContributorSignatureKind(suggestion.contributor),
					...getSuggestionSignatureParts(suggestion),
					suggestion.why ?? "",
				].join("::"),
			);
		}

		return keys.filter((key, index) => keys.indexOf(key) === index);
	}

	private getPersistedReviewDecisionRecord(
		notePath: string,
		suggestion: ReviewSuggestion,
	): PersistedReviewDecisionRecord | undefined {
		for (const key of this.createPersistedReviewDecisionKeys(notePath, suggestion)) {
			const record = this.reviewDecisionIndex[key];
			if (record) {
				return record;
			}
		}

		return undefined;
	}

	private getSceneReviewStatusRank(status: SceneReviewRecord["status"]): number {
		switch (status) {
			case "in_progress":
				return 0;
			case "completed":
				return 1;
			case "cleaned":
				return 2;
		}
	}

	private getOpenNoteText(notePath: string): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as { file?: { path?: string }; editor?: { getValue: () => string } };
			if (view.file?.path !== notePath || !view.editor) {
				continue;
			}

			return view.editor.getValue();
		}

		return null;
	}

	private getNoteIdentityKeys(notePath: string): string[] {
		const sceneId = this.getSceneIdForNotePath(notePath);
		if (!sceneId) {
			return [notePath];
		}

		return [`scene:${sceneId}`, notePath];
	}

	private getSceneIdForNotePath(notePath: string): string | undefined {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return undefined;
		}

		return getSceneIdForFile(this.app, file)?.trim() || undefined;
	}

	private isSceneClassNote(notePath: string): boolean {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return false;
		}

		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		const classValues = getFrontmatterStringValues(frontmatter, ["class", "Class", "classes", "Classes"]);

		return classValues.some((value) => value.trim().toLowerCase() === "scene");
	}

	private sameJsonValue(left: unknown, right: unknown): boolean {
		return JSON.stringify(left) === JSON.stringify(right);
	}

	private createEditorialNoteId(): string {
		return `edt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
	}
}
