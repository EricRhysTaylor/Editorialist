import { TFile, type App } from "obsidian";
import { findImportedReviewBlocks } from "../core/ReviewBlockFormat";
import type { ReviewEngine } from "../core/ReviewEngine";
import {
	buildConfiguredBookScope,
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
import type { AuthorQueryStatus, ReviewSession, ReviewSuggestion } from "../models/ReviewSuggestion";
import type {
	AuthorQueryDecisionRecord,
	EditorialistEffortSettings,
	EditorialistPluginData,
	EditorialistSettings,
	PersistedReviewDecisionRecord,
	ContributorProfile,
	ReviewerSignalRecord,
	SceneReviewRecord,
} from "../models/ContributorProfile";
import type { ContributorDirectory } from "../state/ContributorDirectory";
import { ReviewerStatsProjector } from "./registry/ReviewerStatsProjector";
import { ReviewDecisionIndex } from "./registry/ReviewDecisionIndex";
import {
	normalizeAuthorQueryDecisions,
	normalizeReviewDecisionIndex,
	normalizeReviewerSignalIndex,
	normalizeSceneReviewIndex,
	normalizeSweepRegistry,
} from "./registry/ReviewRegistryNormalization";
import { authorQueryKey } from "../core/AuthorQueryMarker";
import { SweepRegistryManager } from "./registry/SweepRegistryManager";
import { SceneInventoryBuilder } from "./registry/SceneInventoryBuilder";
import { tallyReviewStatuses } from "../core/review/SweepCompletion";
import {
	EDITORIALIST_PLUGIN_DATA_VERSION,
	defaultEditorialistSettings,
	normalizeEditorialistSettings,
} from "./PluginDataMigration";

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

interface BatchDecisionStats {
	accepted: number;
	deferred: number;
	rejected: number;
	rewritten: number;
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
		structured: false,
	};
	private reviewDecisionIndex: Record<string, PersistedReviewDecisionRecord> = {};
	private authorQueryDecisions: Record<string, AuthorQueryDecisionRecord> = {};
	private reviewerSignalIndex: Record<string, ReviewerSignalRecord> = {};
	private sceneReviewIndex: Record<string, SceneReviewRecord> = {};
	private sweepRegistry: Record<string, ReviewSweepRegistryEntry> = {};
	private settings: EditorialistSettings = defaultEditorialistSettings();
	private readonly statsProjector: ReviewerStatsProjector;
	private readonly sweepManager: SweepRegistryManager;
	private readonly inventoryBuilder: SceneInventoryBuilder;
	private readonly decisionIndex: ReviewDecisionIndex;

	constructor(
		private readonly app: App,
		private readonly reviewEngine: ReviewEngine,
		private readonly reviewerDirectory: ContributorDirectory,
		private readonly persistData: () => Promise<void>,
		// Returns the live editor buffer for `notePath` when that note is open
		// in a markdown leaf, or null when no such leaf exists. Injected so the
		// service does not reach `app.workspace` directly — main.ts owns the
		// workspace traversal, the service stays at the vault / persistence
		// layer.
		private readonly openNoteTextResolver: (notePath: string) => string | null,
	) {
		this.statsProjector = new ReviewerStatsProjector(this.reviewerDirectory);
		this.sweepManager = new SweepRegistryManager({
			getSceneReviewIndex: () => this.sceneReviewIndex,
			getActiveBookScope: () => this.activeBookScope,
		});
		this.decisionIndex = new ReviewDecisionIndex({
			noteIdentitiesOf: (notePath) => this.getNoteIdentityKeys(notePath),
		});
		this.inventoryBuilder = new SceneInventoryBuilder({
			getMarkdownFiles: () => this.getScopedMarkdownFiles(),
			resolveNoteText: async (file) =>
				this.openNoteTextResolver(file.path) ?? (await this.app.vault.cachedRead(file)),
			buildEngineSession: (notePath, noteText) =>
				this.reviewEngine.buildSession(notePath, noteText, null),
			applyPersistedReviewState: (session) => this.applyPersistedReviewState(session),
			getPersistedDecisionRecord: (notePath, suggestion) =>
				this.decisionIndex.getRecord(this.reviewDecisionIndex, notePath, suggestion),
			getSceneId: (file) => getSceneIdForFile(this.app, file),
			getBookHint: (notePath) => getBookHintForPath(notePath, this.activeBookScope),
			getSceneReviewIndex: () => this.sceneReviewIndex,
		});
	}

	load(savedData: Partial<EditorialistPluginData> | null): void {
		this.reviewDecisionIndex = normalizeReviewDecisionIndex(savedData?.reviewDecisionIndex);
		this.authorQueryDecisions = normalizeAuthorQueryDecisions(savedData?.authorQueryDecisions);
		this.reviewerSignalIndex = normalizeReviewerSignalIndex(savedData?.reviewerSignalIndex);
		this.sceneReviewIndex = normalizeSceneReviewIndex(savedData?.sceneReviewIndex);
		this.sweepRegistry = normalizeSweepRegistry(savedData?.sweepRegistry);
		this.settings = normalizeEditorialistSettings(savedData?.settings);
	}

	getSettings(): EditorialistSettings {
		return { ...this.settings };
	}

	getCutFolderOverride(): string {
		return this.settings.cutFolderOverride;
	}

	// Stores the raw override string (trimmed). Persistence is the caller's
	// responsibility — main.ts awaits savePluginData() after mutating settings.
	setCutFolderOverride(value: string): void {
		this.settings = {
			...this.settings,
			cutFolderOverride: value.trim(),
		};
	}

	getDetectFileWrittenReviewBlocks(): boolean {
		return this.settings.detectFileWrittenReviewBlocks;
	}

	// Toggles whether the launcher offers to formalize a raw review block written
	// straight into a note. Caller persists via savePluginData().
	setDetectFileWrittenReviewBlocks(value: boolean): void {
		this.settings = {
			...this.settings,
			detectFileWrittenReviewBlocks: value,
		};
	}

	// Merge a partial effort-settings patch. Caller persists via savePluginData().
	setEffortSettings(patch: Partial<EditorialistEffortSettings>): void {
		this.settings = {
			...this.settings,
			effort: { ...this.settings.effort, ...patch },
		};
	}

	getBookFolderOverride(): string {
		return this.settings.bookFolderOverride;
	}

	// Stores the raw override string (trimmed). The caller persists and then
	// calls refreshActiveBookScope() so the new scope takes effect. Has no
	// effect while Radial Timeline is supplying the active-book scope.
	setBookFolderOverride(value: string): void {
		this.settings = {
			...this.settings,
			bookFolderOverride: value.trim(),
		};
	}

	rebuildReviewerStatsFromSignals(): void {
		this.statsProjector.rebuildFromSignals(this.reviewerSignalIndex);
	}

	buildPluginData(reviewerProfiles: ContributorProfile[]): EditorialistPluginData {
		return {
			version: EDITORIALIST_PLUGIN_DATA_VERSION,
			reviewerProfiles,
			reviewerSignalIndex: this.reviewerSignalIndex,
			reviewDecisionIndex: this.reviewDecisionIndex,
			authorQueryDecisions: this.authorQueryDecisions,
			sceneReviewIndex: this.sceneReviewIndex,
			sweepRegistry: this.sweepRegistry,
			settings: { ...this.settings },
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
				this.app.metadataCache.getFileCache(file)?.frontmatter;
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

	// Recent Reviews should read decisions from the same durable source as the
	// Settings activity summary. Modern signal records carry sessionId ===
	// batchId, which is exact; legacy records can still be approximated by
	// joining the sweep's historical note identities.
	getBatchDecisionStats(batchId: string): BatchDecisionStats {
		const exactStatuses = Object.values(this.reviewerSignalIndex)
			.filter((record) => record.sessionId === batchId)
			.map((record) => record.status);
		const signalTotals = tallyReviewStatuses(
			exactStatuses.length > 0 ? exactStatuses : this.getLegacyBatchSignalStatuses(batchId),
		);

		if (signalTotals.totalSuggestions > 0) {
			return {
				accepted: signalTotals.accepted,
				deferred: signalTotals.deferred,
				rejected: signalTotals.rejected,
				rewritten: signalTotals.rewritten,
			};
		}

		const entry = this.getSweepRegistryEntry(batchId);
		if (entry) {
			return {
				accepted: entry.acceptedCount ?? 0,
				deferred: entry.deferredCount ?? 0,
				rejected: entry.rejectedCount ?? 0,
				rewritten: entry.rewrittenCount ?? 0,
			};
		}

		let accepted = 0;
		let deferred = 0;
		let rejected = 0;
		let rewritten = 0;
		for (const record of this.getSceneReviewRecords()) {
			if (!record.batchIds.includes(batchId)) {
				continue;
			}
			accepted += record.acceptedCount;
			deferred += record.deferredCount;
			rejected += record.rejectedCount;
			rewritten += record.rewrittenCount;
		}
		return { accepted, deferred, rejected, rewritten };
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
		const hydrated = this.decisionIndex.applyTo(this.reviewDecisionIndex, session);
		// Reconcile query-memo lifecycle from the separate authorQueryDecisions
		// index. Plain memos are untouched; queries default to "open" when there
		// is no stored decision. Every session-build path calls this method, so
		// query status survives reload everywhere for free.
		const memos = hydrated.memos.map((memo) => {
			if (memo.kind !== "query" || !memo.question) {
				return memo;
			}
			const record = this.authorQueryDecisions[authorQueryKey(hydrated.notePath, memo.question)];
			const status: AuthorQueryStatus = record?.status ?? "open";
			return { ...memo, status };
		});
		return { ...hydrated, memos };
	}

	// Persists a resolve/dismiss decision for a query memo. "open" is never
	// stored — callers don't reopen in the current UI, but if they did, clearing
	// the key would suffice. Idempotent: re-persisting the same status is a no-op.
	async persistAuthorQueryDecision(
		notePath: string,
		question: string,
		status: Exclude<AuthorQueryStatus, "open">,
		options?: { persist?: boolean },
	): Promise<void> {
		const key = authorQueryKey(notePath, question);
		if (this.authorQueryDecisions[key]?.status === status) {
			return;
		}
		this.authorQueryDecisions[key] = { key, status, updatedAt: Date.now() };
		if (options?.persist !== false) {
			await this.persistData();
		}
	}

	async persistReviewDecision(
		notePath: string,
		suggestion: ReviewSuggestion,
		status: PersistedReviewDecisionRecord["status"],
		options?: { persist?: boolean; sessionId?: string; sessionStartedAt?: number },
	): Promise<void> {
		const changed = this.decisionIndex.persist(this.reviewDecisionIndex, notePath, suggestion, status, {
			sessionId: options?.sessionId,
			sessionStartedAt: options?.sessionStartedAt,
		});
		if (changed && options?.persist !== false) {
			await this.persistData();
		}
	}

	async clearPersistedReviewDecision(
		notePath: string,
		suggestion: ReviewSuggestion,
		options?: { persist?: boolean },
	): Promise<void> {
		const removed = this.decisionIndex.clear(this.reviewDecisionIndex, notePath, suggestion);
		if (removed && options?.persist !== false) {
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
		const radialScope = await readRadialTimelineActiveBookScope(this.app);
		// Radial Timeline wins when it supplies a book folder. Otherwise fall back
		// to the configured manuscript folder so non-RT authors still get a
		// bounded scope for the inventory and import routing.
		this.activeBookScope = radialScope.sourceFolder
			? radialScope
			: buildConfiguredBookScope(this.settings.bookFolderOverride);
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
		await fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
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

			await fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
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

	private getNoteIdentityKeys(notePath: string): string[] {
		const sceneId = this.getSceneIdForNotePath(notePath);
		if (!sceneId) {
			return [notePath];
		}

		return [`scene:${sceneId}`, notePath];
	}

	private getHistoricalNoteIdentityKeys(notePath: string): string[] {
		const keys = new Set<string>([notePath]);
		const sceneId = this.getSceneIdForNotePath(notePath) ?? this.sceneReviewIndex[notePath]?.sceneId;
		if (sceneId?.trim()) {
			keys.add(`scene:${sceneId.trim()}`);
		}
		return [...keys];
	}

	private getLegacyBatchSignalStatuses(batchId: string): ReviewerSignalRecord["status"][] {
		const entry = this.getSweepRegistryEntry(batchId);
		if (!entry) {
			return [];
		}

		const notePaths = new Set([
			...entry.importedNotePaths,
			...entry.sceneOrder,
			...(entry.currentNotePath ? [entry.currentNotePath] : []),
		]);
		if (notePaths.size === 0) {
			return [];
		}

		const keyPrefixes = [...notePaths].flatMap((path) =>
			this.getHistoricalNoteIdentityKeys(path).map((identity) => `${identity}::`),
		);

		return Object.values(this.reviewerSignalIndex)
			.filter((record) => !record.sessionId && keyPrefixes.some((prefix) => record.key.startsWith(prefix)))
			.map((record) => record.status);
	}

	private getSceneIdForNotePath(notePath: string): string | undefined {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return undefined;
		}

		return getSceneIdForFile(this.app, file)?.trim() || undefined;
	}

	// Markdown files the inventory is allowed to track. When the active book has
	// a known scope folder (Radial Timeline OR the configured manuscript folder),
	// the inventory is confined to notes inside it, so notes elsewhere in the
	// vault — content logs, briefs, scratch — never become review targets. With
	// no scope folder the whole vault is scanned, preserving prior behavior for
	// authors who have configured neither.
	private getScopedMarkdownFiles(): TFile[] {
		const files = this.app.vault.getMarkdownFiles();
		const scopeFolder = this.activeBookScope.sourceFolder;
		if (!scopeFolder) {
			return files;
		}
		return files.filter((file) => isPathInFolderScope(file.path, scopeFolder));
	}

	private isSceneClassNote(notePath: string): boolean {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return false;
		}

		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
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
