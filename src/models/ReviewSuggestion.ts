import type {
	ContributorKind,
	ParsedContributorReference,
	ReviewerResolutionStatus,
	ReviewerType,
} from "./ContributorProfile";

export const SUPPORTED_REVIEW_OPERATIONS = ["edit", "move", "cut", "condense"] as const;

export type SupportedReviewOperationType = (typeof SUPPORTED_REVIEW_OPERATIONS)[number];

export const SUPPORTED_REVIEW_OPERATION_LABELS: Record<SupportedReviewOperationType, string> = {
	edit: "Edit",
	move: "Move",
	cut: "Cut",
	condense: "Condense",
};

export type ReviewStatus = "pending" | "accepted" | "rejected" | "deferred" | "unresolved" | "rewritten";

export type MatchType = "exact" | "multiple" | "none" | "already_applied";

export type ReviewPlacement = "before" | "after";

export type ReviewExecutionMode = "direct" | "advisory";

export interface ReviewContributor {
	id: string;
	displayName: string;
	kind: ContributorKind;
	reviewerType: ReviewerType;
	provider?: string;
	model?: string;
	reviewerId?: string;
	resolutionStatus: ReviewerResolutionStatus;
	suggestedReviewerIds: string[];
	raw: ParsedContributorReference;
}

export interface ReviewSourceRef {
	blockIndex: number;
	entryIndex: number;
	startOffset?: number;
	endOffset?: number;
}

export interface ReviewTargetRef {
	text: string;
	startOffset?: number;
	endOffset?: number;
	matchType?: MatchType;
	reason?: string;
}

export interface RelocationResolution {
	targetResolved: boolean;
	anchorResolved: boolean;
	alreadyApplied?: boolean;
	targetStart?: number;
	targetEnd?: number;
	anchorStart?: number;
	anchorEnd?: number;
	placement?: ReviewPlacement;
	canApply: boolean;
	reason?: string;
}

export interface ReviewSuggestionLocation {
	primary?: ReviewTargetRef;
	target?: ReviewTargetRef;
	anchor?: ReviewTargetRef;
	relocation?: RelocationResolution;
}

export interface ReviewSuggestionRouting {
	sceneId?: string;
	note?: string;
	path?: string;
	scene?: string;
}

export interface ReviewSuggestionBase<T extends SupportedReviewOperationType, P> {
	id: string;
	operation: T;
	status: ReviewStatus;
	contributor: ReviewContributor;
	source: ReviewSourceRef;
	location: ReviewSuggestionLocation;
	routing?: ReviewSuggestionRouting;
	why?: string;
	executionMode: ReviewExecutionMode;
	payload: P;
}

export interface EditSuggestionPayload {
	original: string;
	revised: string;
}

export interface MoveSuggestionPayload {
	target: string;
	anchor: string;
	placement: ReviewPlacement;
}

export interface CutSuggestionPayload {
	target: string;
}

export interface CondenseTargetAnchorPair {
	start: string;
	end: string;
}

export interface CondenseSuggestionPayload {
	target: string;
	suggestion?: string;
	// When set, the AI emitted anchor fragments instead of the full verbatim
	// passage. The matcher locates each anchor independently and resolves the
	// span [start anchor's startOffset, end anchor's endOffset], then writes
	// the verbatim slice back into `target` so downstream consumers stay
	// unchanged. Parser leaves `target` empty when anchors are present.
	targetAnchors?: CondenseTargetAnchorPair;
}

export type EditSuggestion = ReviewSuggestionBase<"edit", EditSuggestionPayload>;
export type MoveSuggestion = ReviewSuggestionBase<"move", MoveSuggestionPayload>;
export type CutSuggestion = ReviewSuggestionBase<"cut", CutSuggestionPayload>;
export type CondenseSuggestion = ReviewSuggestionBase<"condense", CondenseSuggestionPayload>;

export type ReviewSuggestion = EditSuggestion | MoveSuggestion | CutSuggestion | CondenseSuggestion;

export interface SceneMemo {
	id: string;
	contributor: ReviewContributor;
	source: ReviewSourceRef;
	routing?: ReviewSuggestionRouting;
	strengths?: string;
	issues?: string;
	body?: string;
}

export interface ReviewSession {
	notePath: string;
	hasReviewBlock: boolean;
	parsedAt: number;
	suggestions: ReviewSuggestion[];
	memos: SceneMemo[];
}

export interface ParsedReviewBlock {
	startOffset: number;
	endOffset: number;
	source: "fenced" | "raw";
}

export interface ParsedReviewDocument {
	blockCount: number;
	blocks: ParsedReviewBlock[];
	suggestions: ReviewSuggestion[];
	memos: SceneMemo[];
}

export function isEditSuggestion(suggestion: ReviewSuggestion): suggestion is EditSuggestion {
	return suggestion.operation === "edit";
}

export function isMoveSuggestion(suggestion: ReviewSuggestion): suggestion is MoveSuggestion {
	return suggestion.operation === "move";
}

export function isCutSuggestion(suggestion: ReviewSuggestion): suggestion is CutSuggestion {
	return suggestion.operation === "cut";
}

export function isCondenseSuggestion(suggestion: ReviewSuggestion): suggestion is CondenseSuggestion {
	return suggestion.operation === "condense";
}
