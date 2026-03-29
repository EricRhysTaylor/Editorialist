import type { ReviewSweepRegistryEntry } from "./ReviewImport";
import type { ReviewOperationType } from "./ReviewSuggestion";

export type ReviewerResolutionStatus = "exact" | "alias" | "suggested" | "unresolved" | "new";
export type ContributorKind = "human" | "ai";
export type HumanReviewerType =
	| "author"
	| "beta-reader"
	| "editor"
	| "developmental-editor"
	| "line-editor"
	| "copy-editor"
	| "publisher-editor"
	| "agent"
	| "sensitivity-reader";
export type AiReviewerType =
	| "ai-editor"
	| "ai-developmental-editor"
	| "ai-line-editor"
	| "ai-copy-editor";
export type ReviewerType = HumanReviewerType | AiReviewerType;

export interface ReviewerStats {
	totalSuggestions: number;
	accepted: number;
	deferred: number;
	rejected: number;
	unresolved: number;
	acceptedEdits?: number;
	acceptedMoves?: number;
}

export interface ContributorProfile {
	id: string;
	displayName: string;
	kind: ContributorKind;
	reviewerType: ReviewerType;
	aliases: string[];
	provider?: string;
	model?: string;
	isStarred?: boolean;
	stats?: ReviewerStats;
	createdAt: number;
	updatedAt: number;
}

export type ReviewerProfile = ContributorProfile;

export interface ParsedContributorReference {
	rawName?: string;
	rawType?: string;
	rawProvider?: string;
	rawModel?: string;
}

export type ParsedReviewerReference = ParsedContributorReference;

export interface ContributorResolution {
	reviewerId?: string;
	resolutionStatus: ReviewerResolutionStatus;
	suggestedReviewerIds: string[];
	raw: ParsedContributorReference;
}

export type ReviewerResolution = ContributorResolution;

export interface ReviewerSignalRecord {
	key: string;
	reviewerId: string;
	status: "accepted" | "deferred" | "rejected" | "unresolved";
	operation: ReviewOperationType;
}

export interface PersistedReviewDecisionRecord {
	key: string;
	status: "accepted" | "later" | "rejected";
	updatedAt: number;
}

export interface SceneReviewRecord {
	sceneId?: string;
	notePath: string;
	noteTitle: string;
	bookLabel?: string;
	batchIds: string[];
	batchCount: number;
	pendingCount: number;
	deferredCount: number;
	resolvedCount: number;
	rejectedCount: number;
	status: "completed" | "cleaned" | "in_progress" | "not_started";
	lastUpdated: number;
	cleanedAt?: number;
}

export interface EditorialistPluginData {
	reviewerProfiles: ContributorProfile[];
	reviewerSignalIndex: Record<string, ReviewerSignalRecord>;
	reviewDecisionIndex: Record<string, PersistedReviewDecisionRecord>;
	sceneReviewIndex: Record<string, SceneReviewRecord>;
	sweepRegistry: Record<string, ReviewSweepRegistryEntry>;
}

// TODO Phase 2: add reviewer profile import/export.
// TODO Phase 2: add reviewer tagging such as pacing/tone/line-edit strengths.
// TODO Phase 2: add advanced reviewer and operation-type filtering.
// TODO Phase 2: add explicit batch review sessions grouped by reviewer.
// TODO Phase 2: add explicit review-batch grouping metadata.
