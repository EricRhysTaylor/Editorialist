// Pure persisted-data normalization for the review registry. Extracted
// verbatim from ReviewRegistryService (the private normalize* methods +
// the inline reviewer-signal-index guard in load()). No instance state was
// referenced, so these are plain functions. Behavior — including the legacy
// enum coercion via ReviewStatusModel, the `Date.now()` fallbacks, the
// resolvedCount->acceptedCount migration, and the frozen sweep decision
// counts — is byte-identical. This is normalization ONLY; it never changes
// the persisted data shape and performs no migration write-back.
//
// The protecting tests are the Pass-2 invariants
// (ReviewRegistryService.invariants.test.ts: legacy aliases, null/garbage
// blobs, load->build->load round-trip) plus direct tests here.

import type {
	PersistedReviewDecisionRecord,
	ReviewerSignalRecord,
	SceneReviewRecord,
} from "../../models/ContributorProfile";
import type { ReviewSweepRegistryEntry } from "../../models/ReviewImport";
import {
	normalizeReviewDecisionStatus,
	normalizeSceneStatus,
	normalizeSweepStatus,
} from "../../core/status/ReviewStatusModel";

export function normalizeReviewDecisionIndex(
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
			return [
				key,
				{
					key,
					status: normalizeReviewDecisionStatus(record?.status),
					updatedAt: record?.updatedAt ?? Date.now(),
					sessionId: record?.sessionId,
					sessionStartedAt: record?.sessionStartedAt,
				},
			];
		}),
	);
}

// Reviewer signals carry no legacy enum; the original load() kept the saved
// object as-is (same reference, no clone) when it was an object, else {}.
export function normalizeReviewerSignalIndex(
	index: Record<string, ReviewerSignalRecord> | undefined,
): Record<string, ReviewerSignalRecord> {
	return index && typeof index === "object" ? index : {};
}

export function normalizeSceneReviewIndex(
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
					status: normalizeSceneStatus(record?.status),
					lastUpdated: record?.lastUpdated ?? Date.now(),
					cleanedAt: record?.cleanedAt,
				},
			];
		}),
	);
}

export function normalizeSweepRegistry(
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
			return [
				batchId,
				{
					batchId,
					contentHash: entry?.contentHash ?? "",
					activeBookLabel: entry?.activeBookLabel,
					activeBookSourceFolder: entry?.activeBookSourceFolder,
					cleanedAt: entry?.cleanedAt,
					editorialRevisionUpdatedNotePaths: [...(entry?.editorialRevisionUpdatedNotePaths ?? [])],
					importedAt: entry?.importedAt ?? Date.now(),
					importedNotePaths: [...(entry?.importedNotePaths ?? [])],
					currentNotePath: entry?.currentNotePath,
					sceneOrder: [...(entry?.sceneOrder ?? [])],
					status: normalizeSweepStatus(entry?.status),
					totalSuggestions: entry?.totalSuggestions ?? 0,
					updatedAt: entry?.updatedAt ?? Date.now(),
					// Frozen historical decision counts: preserve across reload.
					// Dropping these reset every cleaned sweep's Recent Reviews
					// stats to zero on each plugin restart.
					acceptedCount: entry?.acceptedCount,
					rejectedCount: entry?.rejectedCount,
					rewrittenCount: entry?.rewrittenCount,
					deferredCount: entry?.deferredCount,
				},
			];
		}),
	);
}
