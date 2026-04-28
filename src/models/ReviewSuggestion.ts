import type {
	ContributorKind,
	ParsedReviewerReference,
	ReviewerResolutionStatus,
	ReviewerType,
} from "./ReviewerProfile";

export const SUPPORTED_REVIEW_OPERATIONS = ["edit", "move", "cut", "condense"] as const;

export type SupportedReviewOperationType = (typeof SUPPORTED_REVIEW_OPERATIONS)[number];

export const SUPPORTED_REVIEW_OPERATION_LABELS: Record<SupportedReviewOperationType, string> = {
	edit: "Edit",
	move: "Move",
	cut: "Cut",
	condense: "Condense",
};

export type ReviewOperationType = SupportedReviewOperationType | "insert" | "split" | "merge" | "advisory";

export type ReviewStatus = "pending" | "accepted" | "rejected" | "deferred" | "unresolved" | "rewritten";

export type MatchType = "exact" | "multiple" | "none" | "text_changed" | "already_applied";

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
	raw: ParsedReviewerReference;
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

export interface CondenseSuggestionPayload {
	target: string;
	suggestion?: string;
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

// TODO Phase 2: add first-class insert parsing, matching, and apply support.
// TODO Phase 2: add split and merge operations with dedicated validation rules.
// TODO Phase 2: add advisory-only suggestion variants with richer non-apply workflows.
// TODO Phase 2: add reviewer filtering and grouped review passes or batches.
