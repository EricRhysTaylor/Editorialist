import type { ReviewSweepRegistryEntry } from "./ReviewImport";
import type { SupportedReviewOperationType } from "./ReviewSuggestion";

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
export type ContributorStrength =
	| "clarity"
	| "tone"
	| "pacing"
	| "dialogue"
	| "structure"
	| "character"
	| "worldbuilding"
	| "tightening";

export interface ReviewerStats {
	totalSuggestions: number;
	accepted: number;
	pending?: number;
	deferred: number;
	rejected: number;
	rewritten: number;
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
	strengths?: ContributorStrength[];
	provider?: string;
	model?: string;
	isStarred?: boolean;
	stats?: ReviewerStats;
	createdAt: number;
	updatedAt: number;
}

export interface ParsedContributorReference {
	rawName?: string;
	rawType?: string;
	rawProvider?: string;
	rawModel?: string;
}

export interface ContributorResolution {
	reviewerId?: string;
	resolutionStatus: ReviewerResolutionStatus;
	suggestedReviewerIds: string[];
	raw: ParsedContributorReference;
}


export interface ReviewerSignalRecord {
	key: string;
	reviewerId: string;
	status: "accepted" | "pending" | "deferred" | "rejected" | "rewritten" | "unresolved";
	operation: SupportedReviewOperationType;
	sessionId?: string;
	sessionStartedAt?: number;
}

export interface PersistedReviewDecisionRecord {
	key: string;
	status: "accepted" | "deferred" | "rejected" | "rewritten";
	updatedAt: number;
	sessionId?: string;
	sessionStartedAt?: number;
}

export interface SceneReviewRecord {
	sceneId?: string;
	notePath: string;
	noteTitle: string;
	bookLabel?: string;
	batchIds: string[];
	batchCount: number;
	pendingCount: number;
	unresolvedCount: number;
	deferredCount: number;
	acceptedCount: number;
	rejectedCount: number;
	rewrittenCount: number;
	status: "completed" | "cleaned" | "in_progress";
	lastUpdated: number;
	cleanedAt?: number;
}

// User-tunable plugin settings persisted alongside the review indices. Kept as
// a discrete object (rather than loose top-level fields) so the Configuration
// tab can grow without churning the EditorialistPluginData surface.
// Author-tunable inputs to the revision-effort estimate (editorialism mode).
// Drafting rate is creative words/hour, NOT typing speed. The scope/tier
// weighting lives in code defaults; these are the knobs authors actually vary.
export interface EditorialistEffortSettings {
	wordsPerNewScene: number;
	draftRateWordsPerHour: number;
	minutesPerDirective: number;
	dailyWritingHours: number;
}

export interface EditorialistSettings {
	// Optional explicit cut-folder path. Empty string means "unset" — cut-file
	// resolution then falls back to the active book's source folder, or the
	// scene's own folder. Stored verbatim; normalized at use time.
	cutFolderOverride: string;
	// Optional explicit manuscript/book folder. Empty string means "unset".
	// When Radial Timeline is not driving the active-book scope, this folder
	// becomes the scope root: the scene inventory and import routing are
	// confined to notes inside it, so non-RT authors (who have no Class: Scene
	// frontmatter) can still keep review tracking bounded to their manuscript.
	// Ignored while Radial Timeline supplies a scope. Normalized at use time.
	bookFolderOverride: string;
	// Inputs to the editorialism revision-effort estimate.
	effort: EditorialistEffortSettings;
}

// A resolved/dismissed decision on a query memo (kind:"query"). Keyed by
// note path + question (see authorQueryKey). "open" is never stored — absence
// of a record means open. Separate from reviewDecisionIndex because queries
// have no operation/contributor signature to key on, and the suggestion index
// is guarded by invariants that require every key to resolve to a suggestion.
export interface AuthorQueryDecisionRecord {
	key: string;
	status: "resolved" | "dismissed";
	updatedAt: number;
}

export interface EditorialistPluginData {
	version: number;
	reviewerProfiles: ContributorProfile[];
	reviewerSignalIndex: Record<string, ReviewerSignalRecord>;
	reviewDecisionIndex: Record<string, PersistedReviewDecisionRecord>;
	authorQueryDecisions: Record<string, AuthorQueryDecisionRecord>;
	sceneReviewIndex: Record<string, SceneReviewRecord>;
	sweepRegistry: Record<string, ReviewSweepRegistryEntry>;
	settings: EditorialistSettings;
}
