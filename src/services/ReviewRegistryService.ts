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
	ReviewerProfile,
	ReviewerSignalRecord,
	SceneReviewRecord,
} from "../models/ReviewerProfile";
import type { ReviewerDirectory } from "../state/ReviewerDirectory";
import { getLegacyContributorSignatureKind } from "../core/ContributorIdentity";
import { getSuggestionSignatureParts } from "../core/OperationSupport";

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

export class ReviewRegistryService {
	private activeBookScope: ActiveBookScopeInfo = {
		label: null,
		sourceFolder: null,
	};
	private reviewDecisionIndex: Record<string, PersistedReviewDecisionRecord> = {};
	private reviewerSignalIndex: Record<string, ReviewerSignalRecord> = {};
	private sceneReviewIndex: Record<string, SceneReviewRecord> = {};
	private sweepRegistry: Record<string, ReviewSweepRegistryEntry> = {};

	constructor(
		private readonly app: App,
		private readonly reviewEngine: ReviewEngine,
		private readonly reviewerDirectory: ReviewerDirectory,
		private readonly persistData: () => Promise<void>,
	) {}

	load(savedData: Partial<EditorialistPluginData> | null): void {
		this.reviewDecisionIndex = this.normalizeReviewDecisionIndex(savedData?.reviewDecisionIndex);
		this.reviewerSignalIndex =
			savedData?.reviewerSignalIndex && typeof savedData.reviewerSignalIndex === "object"
				? savedData.reviewerSignalIndex
				: {};
		this.sceneReviewIndex = this.normalizeSceneReviewIndex(savedData?.sceneReviewIndex);
		this.sweepRegistry = this.normalizeSweepRegistry(savedData?.sweepRegistry);
	}

	buildPluginData(reviewerProfiles: ReviewerProfile[]): EditorialistPluginData {
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

	getSweepRegistryEntries(): ReviewSweepRegistryEntry[] {
		return Object.values(this.sweepRegistry).sort((left, right) => right.updatedAt - left.updatedAt);
	}

	getSweepRegistryEntry(batchId?: string): ReviewSweepRegistryEntry | null {
		if (!batchId) {
			return null;
		}

		return this.sweepRegistry[batchId] ?? null;
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

	getReviewActivitySummary(reviewerProfiles: ReviewerProfile[]): ReviewActivitySummary {
		const sceneTotals = this.getSceneReviewRecords().reduce(
			(totals, record) => {
				totals.totalSuggestions +=
					record.pendingCount +
					record.unresolvedCount +
					record.deferredCount +
					record.acceptedCount +
					record.rejectedCount +
					record.rewrittenCount;
				totals.accepted += record.acceptedCount;
				totals.deferred += record.deferredCount;
				totals.pending += record.pendingCount;
				totals.rejected += record.rejectedCount;
				totals.rewritten += record.rewrittenCount;
				totals.unresolved += record.unresolvedCount;
				return totals;
			},
			{
				totalSuggestions: 0,
				accepted: 0,
				deferred: 0,
				pending: 0,
				rejected: 0,
				rewritten: 0,
				unresolved: 0,
			},
		);
		const reviewerTotals = reviewerProfiles.reduce(
			(totals, profile) => {
				totals.totalSuggestions += profile.stats?.totalSuggestions ?? 0;
				totals.accepted += profile.stats?.accepted ?? 0;
				totals.deferred += profile.stats?.deferred ?? 0;
				totals.rejected += profile.stats?.rejected ?? 0;
				totals.rewritten += profile.stats?.rewritten ?? 0;
				totals.unresolved += profile.stats?.unresolved ?? 0;
				return totals;
			},
			{
				totalSuggestions: 0,
				accepted: 0,
				deferred: 0,
				pending: 0,
				rejected: 0,
				rewritten: 0,
				unresolved: 0,
			},
		);
		const entries = this.getSweepRegistryEntries();
		const totals = sceneTotals.totalSuggestions > 0 ? sceneTotals : reviewerTotals;

		return {
			...totals,
			processed: Math.max(0, totals.totalSuggestions - totals.pending - totals.unresolved),
			totalSweeps: entries.length,
			inProgressSweeps: entries.filter((entry) => entry.status === "in_progress").length,
			completedSweeps: entries.filter((entry) => entry.status === "completed").length,
			cleanedSweeps: entries.filter((entry) => entry.status === "cleaned").length,
		};
	}

	getReviewPanelWarnings(notePath: string): string[] {
		const warnings: string[] = [];
		if (!this.isSceneClassNote(notePath)) {
			warnings.push("Warning: current note is not a scene.");
		}

		if (
			this.activeBookScope.sourceFolder &&
			!isPathInFolderScope(notePath, this.activeBookScope.sourceFolder)
		) {
			const activeBookLabel = this.activeBookScope.label ?? "the active book";
			warnings.push(`Warning: current note is outside the active book, ${activeBookLabel}.`);
		}

		if (/(^|\/)(exports?|archives?|drafts?|revisions?)(\/|$)/i.test(notePath)) {
			warnings.push("Warning: current note appears to be an export, archive, draft, or revision note.");
		}

		return warnings;
	}

	findDuplicateSweep(batch: ReviewImportBatch): ReviewSweepRegistryEntry | null {
		return (
			Object.values(this.sweepRegistry).find(
				(entry) => entry.contentHash === batch.contentHash && entry.status !== "cleaned",
			) ?? null
		);
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

		let didChange = false;
		const nextIndex = {
			...this.reviewerSignalIndex,
		};
		const activeKeys = new Set<string>();

		for (const suggestion of session.suggestions) {
			const key = this.createReviewerSignalKey(session.notePath, suggestion);
			activeKeys.add(key);
			const existingRecord = nextIndex[key];
			const desiredRecord = this.createReviewerSignalRecord(
				key,
				suggestion,
				options?.sessionId,
				options?.sessionStartedAt,
			);

			if (this.sameReviewerSignalRecord(existingRecord, desiredRecord)) {
				continue;
			}

			if (existingRecord) {
				this.applyReviewerSignalDelta(existingRecord, -1);
				delete nextIndex[key];
				didChange = true;
			}

			if (desiredRecord) {
				this.applyReviewerSignalDelta(desiredRecord, 1);
				nextIndex[key] = desiredRecord;
				didChange = true;
			}
		}

		for (const [key, existingRecord] of Object.entries(nextIndex)) {
			if (!key.startsWith(`${session.notePath}::`) || activeKeys.has(key)) {
				continue;
			}

			this.applyReviewerSignalDelta(existingRecord, -1);
			delete nextIndex[key];
			didChange = true;
		}

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
		const nextIndex: Record<string, SceneReviewRecord> = {};
		const batchPresence = new Map<string, Set<string>>();
		const now = Date.now();

		for (const file of this.app.vault.getMarkdownFiles()) {
			const noteText =
				this.getOpenNoteText(file.path) ?? (await this.app.vault.cachedRead(file));
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

			const session = this.applyPersistedReviewState(this.reviewEngine.buildSession(file.path, noteText, null));
			let acceptedCount = 0;
			let deferredCount = 0;
			let pendingCount = 0;
			let rejectedCount = 0;
			let rewrittenCount = 0;
			let unresolvedCount = 0;
			let lastDecisionAt = 0;

			for (const suggestion of session.suggestions) {
				const record = this.getPersistedReviewDecisionRecord(file.path, suggestion);
				if (record?.updatedAt) {
					lastDecisionAt = Math.max(lastDecisionAt, record.updatedAt);
				}

				switch (suggestion.status) {
					case "accepted":
						acceptedCount += 1;
						break;
					case "deferred":
						deferredCount += 1;
						break;
					case "pending":
						pendingCount += 1;
						break;
					case "rejected":
						rejectedCount += 1;
						break;
					case "rewritten":
						rewrittenCount += 1;
						break;
					case "unresolved":
						unresolvedCount += 1;
						break;
				}
			}

			nextIndex[file.path] = {
				sceneId: getSceneIdForFile(this.app, file),
				notePath: file.path,
				noteTitle: file.basename,
				bookLabel: getBookHintForPath(file.path, this.activeBookScope),
				batchIds,
				batchCount: batchIds.length,
				pendingCount,
				unresolvedCount,
				deferredCount,
				acceptedCount,
				rejectedCount,
				rewrittenCount,
				status:
					pendingCount === 0 && unresolvedCount === 0 && deferredCount === 0
						? "completed"
						: "in_progress",
				lastUpdated: Math.max(file.stat.mtime, lastDecisionAt),
			};
		}

		for (const existing of Object.values(this.sceneReviewIndex)) {
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

		const nextRegistry = this.buildSweepRegistryFromSceneInventory(batchPresence, now);
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

	async recordImportedBatch(
		batch: ReviewImportBatch,
		importedGroups: ReviewImportNoteGroup[],
		status: ReviewSweepStatus,
		currentNotePath?: string,
	): Promise<void> {
		const now = Date.now();
		this.sweepRegistry[batch.batchId] = {
			activeBookLabel: this.activeBookScope.label ?? undefined,
			activeBookSourceFolder: this.activeBookScope.sourceFolder ?? undefined,
			batchId: batch.batchId,
			contentHash: batch.contentHash,
			importedAt: batch.createdAt,
			importedNotePaths: importedGroups.map((group) => group.filePath),
			currentNotePath: currentNotePath ?? importedGroups[0]?.filePath,
			sceneOrder: importedGroups.map((group) => group.filePath),
			status,
			totalSuggestions: batch.summary.totalSuggestions,
			updatedAt: now,
		};
		await this.syncSceneInventory();
	}

	async updateSweepRegistry(
		batchId: string,
		updates: Partial<ReviewSweepRegistryEntry>,
		options?: { persist?: boolean },
	): Promise<void> {
		const existing = this.sweepRegistry[batchId];
		if (!existing) {
			return;
		}

		const hasMeaningfulChange = Object.entries(updates).some(([key, value]) => existing[key as keyof ReviewSweepRegistryEntry] !== value);
		if (!hasMeaningfulChange) {
			return;
		}

		this.sweepRegistry[batchId] = {
			...existing,
			...updates,
			updatedAt: Date.now(),
		};
		if (options?.persist !== false) {
			await this.persistData();
		}
	}

	async clearCleanedSweepRecords(): Promise<number> {
		return 0;
	}

	buildMetadataExport(reviewerProfiles: ReviewerProfile[]): EditorialistMetadataExport {
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
		const stableKey = [
			notePath,
			suggestion.operation,
			suggestion.executionMode,
			suggestion.contributor.raw.rawName ?? "",
			suggestion.contributor.raw.rawType ?? "",
			suggestion.contributor.raw.rawProvider ?? "",
			suggestion.contributor.raw.rawModel ?? "",
			...getSuggestionSignatureParts(suggestion),
			suggestion.why ?? "",
		].join("::");
		const legacyKey = [
			notePath,
			suggestion.operation,
			suggestion.executionMode,
			suggestion.contributor.displayName,
			getLegacyContributorSignatureKind(suggestion.contributor),
			...getSuggestionSignatureParts(suggestion),
			suggestion.why ?? "",
		].join("::");
		return stableKey === legacyKey ? [stableKey] : [stableKey, legacyKey];
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

	private createReviewerSignalKey(notePath: string, suggestion: ReviewSuggestion): string {
		return [
			notePath,
			suggestion.source.blockIndex,
			suggestion.source.entryIndex,
			suggestion.operation,
			suggestion.executionMode,
			...getSuggestionSignatureParts(suggestion),
		].join("::");
	}

	private createReviewerSignalRecord(
		key: string,
		suggestion: ReviewSuggestion,
		sessionId?: string,
		sessionStartedAt?: number,
	): ReviewerSignalRecord | null {
		const reviewerId = suggestion.contributor.reviewerId;
		if (!reviewerId) {
			return null;
		}

		return {
			key,
			reviewerId,
			status:
				suggestion.status === "accepted"
					? "accepted"
					: suggestion.status === "rejected"
						? "rejected"
						: suggestion.status === "rewritten"
							? "rewritten"
						: suggestion.status === "deferred"
							? "deferred"
							: "unresolved",
			operation: suggestion.operation,
			sessionId,
			sessionStartedAt,
		};
	}

	private sameReviewerSignalRecord(
		left: ReviewerSignalRecord | undefined,
		right: ReviewerSignalRecord | null,
	): boolean {
		if (!left && !right) {
			return true;
		}

		if (!left || !right) {
			return false;
		}

		return (
			left.key === right.key &&
			left.reviewerId === right.reviewerId &&
			left.status === right.status &&
			left.operation === right.operation &&
			left.sessionId === right.sessionId &&
			left.sessionStartedAt === right.sessionStartedAt
		);
	}

	private applyReviewerSignalDelta(record: ReviewerSignalRecord, direction: 1 | -1): void {
		const profile = this.reviewerDirectory.getProfileById(record.reviewerId);
		if (!profile) {
			return;
		}

		const stats = {
			totalSuggestions: profile.stats?.totalSuggestions ?? 0,
			accepted: profile.stats?.accepted ?? 0,
			deferred: profile.stats?.deferred ?? 0,
			rejected: profile.stats?.rejected ?? 0,
			rewritten: profile.stats?.rewritten ?? 0,
			unresolved: profile.stats?.unresolved ?? 0,
			acceptedEdits: profile.stats?.acceptedEdits ?? 0,
			acceptedMoves: profile.stats?.acceptedMoves ?? 0,
		};

		stats.totalSuggestions = Math.max(0, stats.totalSuggestions + direction);
		if (record.status === "accepted") {
			stats.accepted = Math.max(0, stats.accepted + direction);
			if (record.operation === "move") {
				stats.acceptedMoves = Math.max(0, (stats.acceptedMoves ?? 0) + direction);
			} else if (record.operation === "edit" || record.operation === "cut" || record.operation === "condense") {
				stats.acceptedEdits = Math.max(0, (stats.acceptedEdits ?? 0) + direction);
			}
		} else if (record.status === "rejected") {
			stats.rejected = Math.max(0, stats.rejected + direction);
		} else if (record.status === "rewritten") {
			stats.rewritten = Math.max(0, stats.rewritten + direction);
		} else if (record.status === "deferred") {
			stats.deferred = Math.max(0, stats.deferred + direction);
		} else {
			stats.unresolved = Math.max(0, stats.unresolved + direction);
		}

		this.reviewerDirectory.setStats(record.reviewerId, stats);
	}

	private buildSweepRegistryFromSceneInventory(
		batchPresence: Map<string, Set<string>>,
		now: number,
	): Record<string, ReviewSweepRegistryEntry> {
		const nextRegistry: Record<string, ReviewSweepRegistryEntry> = {};
		for (const entry of Object.values(this.sweepRegistry)) {
			const currentPaths = [...(batchPresence.get(entry.batchId) ?? new Set<string>())].sort();
			const sceneOrder = entry.sceneOrder.filter((path) => currentPaths.includes(path));
			const nextSceneOrder = sceneOrder.length > 0 ? sceneOrder : currentPaths;
			const currentNotePath =
				entry.currentNotePath && currentPaths.includes(entry.currentNotePath)
					? entry.currentNotePath
					: nextSceneOrder[0];

			nextRegistry[entry.batchId] = {
				...entry,
				activeBookLabel: entry.activeBookLabel ?? this.activeBookScope.label ?? undefined,
				activeBookSourceFolder: entry.activeBookSourceFolder ?? this.activeBookScope.sourceFolder ?? undefined,
				cleanedAt: currentPaths.length === 0 ? entry.cleanedAt ?? now : undefined,
				importedNotePaths: currentPaths,
				currentNotePath,
				sceneOrder: nextSceneOrder,
				status: currentPaths.length === 0 ? "cleaned" : entry.status,
				updatedAt: now,
			};
		}

		return nextRegistry;
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

	private isSceneClassNote(notePath: string): boolean {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return false;
		}

		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		const classValues = getFrontmatterStringValues(frontmatter, ["class", "Class", "classes", "Classes"]);

		return classValues.some((value) => value.trim().toLowerCase() === "scene");
	}

	private normalizeReviewDecisionIndex(
		index:
			| Partial<
					Record<
						string,
						Partial<PersistedReviewDecisionRecord> & {
							status?: PersistedReviewDecisionRecord["status"] | "later";
						}
					>
			  >
			| undefined,
	): Record<string, PersistedReviewDecisionRecord> {
		if (!index || typeof index !== "object") {
			return {};
		}

		return Object.fromEntries(
			Object.entries(index).map(([key, record]) => {
				const legacyStatus = record?.status as string | undefined;
				return [
					key,
					{
						key,
						status: legacyStatus === "later" ? "deferred" : (legacyStatus as PersistedReviewDecisionRecord["status"] | undefined) ?? "deferred",
						updatedAt: record?.updatedAt ?? Date.now(),
						sessionId: record?.sessionId,
						sessionStartedAt: record?.sessionStartedAt,
					},
				];
			}),
		);
	}

	private normalizeSceneReviewIndex(
		index:
			| Partial<
					Record<
						string,
						Partial<SceneReviewRecord> & {
							resolvedCount?: number;
							status?: SceneReviewRecord["status"] | "not_started";
						}
					>
			  >
			| undefined,
	): Record<string, SceneReviewRecord> {
		if (!index || typeof index !== "object") {
			return {};
		}

		return Object.fromEntries(
			Object.entries(index).map(([notePath, record]) => {
				const legacyStatus = record?.status as string | undefined;
				return [
					notePath,
					{
						sceneId: record?.sceneId,
						notePath: record?.notePath ?? notePath,
						noteTitle: record?.noteTitle ?? notePath,
						bookLabel: record?.bookLabel,
						batchIds: [...(record?.batchIds ?? [])],
						batchCount: record?.batchCount ?? (record?.batchIds?.length ?? 0),
						pendingCount: record?.pendingCount ?? 0,
						unresolvedCount: record?.unresolvedCount ?? 0,
						deferredCount: record?.deferredCount ?? 0,
						acceptedCount: record?.acceptedCount ?? record?.resolvedCount ?? 0,
						rejectedCount: record?.rejectedCount ?? 0,
						rewrittenCount: record?.rewrittenCount ?? 0,
						status: legacyStatus === "not_started" ? "in_progress" : (legacyStatus as SceneReviewRecord["status"] | undefined) ?? "in_progress",
						lastUpdated: record?.lastUpdated ?? Date.now(),
						cleanedAt: record?.cleanedAt,
					},
				];
			}),
		);
	}

	private normalizeSweepRegistry(
		registry:
			| Partial<
					Record<
						string,
						Partial<ReviewSweepRegistryEntry> & {
							status?: ReviewSweepRegistryEntry["status"] | "cleaned_up" | "imported";
						}
					>
			  >
			| undefined,
	): Record<string, ReviewSweepRegistryEntry> {
		if (!registry || typeof registry !== "object") {
			return {};
		}

		return Object.fromEntries(
			Object.entries(registry).map(([batchId, entry]) => {
				const legacyStatus = entry?.status as string | undefined;
				return [
					batchId,
					{
						batchId,
						contentHash: entry?.contentHash ?? "",
						activeBookLabel: entry?.activeBookLabel,
						activeBookSourceFolder: entry?.activeBookSourceFolder,
						cleanedAt: entry?.cleanedAt,
						importedAt: entry?.importedAt ?? Date.now(),
						importedNotePaths: [...(entry?.importedNotePaths ?? [])],
						currentNotePath: entry?.currentNotePath,
						sceneOrder: [...(entry?.sceneOrder ?? [])],
						status:
							legacyStatus === "cleaned_up"
								? "cleaned"
								: legacyStatus === "imported"
									? "in_progress"
									: (legacyStatus as ReviewSweepRegistryEntry["status"] | undefined) ?? "in_progress",
						totalSuggestions: entry?.totalSuggestions ?? 0,
						updatedAt: entry?.updatedAt ?? Date.now(),
					},
				];
			}),
		);
	}

	private sameJsonValue(left: unknown, right: unknown): boolean {
		return JSON.stringify(left) === JSON.stringify(right);
	}
}
