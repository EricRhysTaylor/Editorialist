import type { ReviewSweepRegistryEntry } from "./ReviewImport";
import type { ReviewContributorKind, ReviewOperationType } from "./ReviewSuggestion";

export type ReviewerResolutionStatus = "exact" | "alias" | "suggested" | "unresolved" | "new";

export interface ReviewerStats {
	totalSuggestions: number;
	accepted: number;
	rejected: number;
	unresolved: number;
	acceptedEdits?: number;
	acceptedMoves?: number;
}

export interface ReviewerProfile {
	id: string;
	displayName: string;
	shortLabel?: string;
	kind: ReviewContributorKind;
	aliases: string[];
	provider?: string;
	model?: string;
	isStarred?: boolean;
	stats?: ReviewerStats;
	createdAt: number;
	updatedAt: number;
}

export interface ParsedReviewerReference {
	rawName?: string;
	rawType?: string;
	rawProvider?: string;
	rawModel?: string;
}

export interface ReviewerResolution {
	reviewerId?: string;
	resolutionStatus: ReviewerResolutionStatus;
	suggestedReviewerIds: string[];
	raw: ParsedReviewerReference;
}

export interface ReviewerSignalRecord {
	key: string;
	reviewerId: string;
	status: "accepted" | "rejected" | "unresolved";
	operation: ReviewOperationType;
}

export interface EditorialistPluginData {
	reviewerProfiles: ReviewerProfile[];
	reviewerSignalIndex: Record<string, ReviewerSignalRecord>;
	sweepRegistry: Record<string, ReviewSweepRegistryEntry>;
}

// TODO Phase 2: add reviewer profile import/export.
// TODO Phase 2: add reviewer tagging such as pacing/tone/line-edit strengths.
// TODO Phase 2: add advanced reviewer and operation-type filtering.
// TODO Phase 2: add explicit batch review sessions grouped by reviewer.
// TODO Phase 2: add explicit review-batch grouping metadata.
