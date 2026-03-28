import type { ParsedReviewerReference, ReviewerResolutionStatus } from "./ReviewerProfile";

export type ReviewOperationType = "replace" | "move" | "insert" | "delete";

export type ReviewStatus = "pending" | "accepted" | "rejected" | "unresolved";

export type MatchType = "exact" | "multiple" | "none" | "text_changed" | "already_applied";

export type ReviewContributorKind = "author" | "editor" | "beta-reader" | "ai";

export type ReviewPlacement = "before" | "after";

export interface ReviewContributor {
	id: string;
	displayName: string;
	kind: ReviewContributorKind;
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
	targetStart?: number;
	targetEnd?: number;
	anchorStart?: number;
	anchorEnd?: number;
	placement?: ReviewPlacement;
	canApply: boolean;
	reason?: string;
}

export interface ReviewSuggestion {
	id: string;
	operation: ReviewOperationType;
	contributor: ReviewContributor;
	source: ReviewSourceRef;
	why?: string;
	status: ReviewStatus;
	original?: string;
	revised?: string;
	target?: ReviewTargetRef;
	anchor?: ReviewTargetRef;
	placement?: ReviewPlacement;
	manuscriptMatch?: ReviewTargetRef;
	relocation?: RelocationResolution;
}

export interface ReviewSession {
	notePath: string;
	hasReviewBlock: boolean;
	parsedAt: number;
	suggestions: ReviewSuggestion[];
}

export interface ParsedReviewDocument {
	blockCount: number;
	suggestions: ReviewSuggestion[];
}

// TODO Phase 2: add first-class insert and delete parsing/apply support.
// TODO Phase 2: add reviewer filtering and grouped review passes/batches.
