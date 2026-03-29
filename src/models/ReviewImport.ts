import type { ReviewSuggestion } from "./ReviewSuggestion";

export type ReviewRouteStatus = "resolved" | "mismatch" | "unresolved";

export type ReviewVerificationStatus =
	| "exact"
	| "multiple"
	| "none"
	| "advisory"
	| "note_unresolved";

export type ReviewSweepStatus = "imported" | "in_progress" | "completed" | "cleaned_up";

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
	mismatchCount: number;
	isReady: boolean;
}

export interface ReviewImportSummary {
	totalSuggestions: number;
	totalMatchedScenes: number;
	totalResolvedScenes: number;
	totalUnresolvedScenes: number;
	totalMismatches: number;
	totalExactMatches: number;
	totalAdvisoryOnly: number;
	totalUnresolvedMatches: number;
}

export interface ReviewImportBatch {
	batchId: string;
	contentHash: string;
	createdAt: number;
	rawText: string;
	results: ReviewImportSuggestionResult[];
	groups: ReviewImportNoteGroup[];
	summary: ReviewImportSummary;
}

export interface ReviewSweepRegistryEntry {
	batchId: string;
	contentHash: string;
	importedAt: number;
	importedNotePaths: string[];
	currentNotePath?: string;
	sceneOrder: string[];
	status: ReviewSweepStatus;
	totalSuggestions: number;
	updatedAt: number;
}
