import type { ReviewSuggestion } from "./ReviewSuggestion";

export type ReviewRouteStatus = "resolved" | "mismatch" | "unresolved";

export type ReviewVerificationStatus =
	| "exact"
	| "multiple"
	| "none"
	| "advisory"
	| "note_unresolved";

export interface ReviewImportSuggestionResult {
	suggestion: ReviewSuggestion;
	resolvedPath?: string;
	resolvedNoteTitle?: string;
	routeStatus: ReviewRouteStatus;
	routeReason: string;
	verificationStatus: ReviewVerificationStatus;
	verificationReason: string;
}

export interface ReviewImportNoteGroup {
	filePath: string;
	fileName: string;
	sceneId?: string;
	suggestions: ReviewImportSuggestionResult[];
	exactCount: number;
	advisoryCount: number;
	unresolvedCount: number;
	isReady: boolean;
}

export interface ReviewImportSummary {
	totalSuggestions: number;
	totalResolvedScenes: number;
	totalUnresolvedScenes: number;
	totalExactMatches: number;
	totalAdvisoryOnly: number;
	totalUnresolvedMatches: number;
}

export interface ReviewImportBatch {
	rawText: string;
	results: ReviewImportSuggestionResult[];
	groups: ReviewImportNoteGroup[];
	summary: ReviewImportSummary;
}
