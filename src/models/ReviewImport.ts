import type { ReviewSuggestion } from "./ReviewSuggestion";

export type ReviewRouteStatus = "resolved" | "mismatch" | "unresolved";
export type ReviewRouteStrategy =
	| "declared_scene_id"
	| "declared_path"
	| "declared_note"
	| "declared_scene"
	| "inferred_exact"
	| "inferred_normalized"
	| "unresolved";

export type ReviewVerificationStatus =
	| "exact"
	| "multiple"
	| "none"
	| "advisory"
	| "note_unresolved";

export type ReviewSweepStatus = "in_progress" | "completed" | "cleaned";

export interface EditorialistMetadataExport {
	schemaVersion: string;
	exportedAt: number;
	contributors: {
		createdAt: number;
		displayName: string;
		id: string;
		kind: string;
		reviewerType: string;
		aliases: string[];
		isStarred?: boolean;
		model?: string;
		provider?: string;
		stats?: Record<string, number | undefined>;
		updatedAt: number;
	}[];
	scenes: {
		batchCount: number;
		batchIds: string[];
		bookLabel?: string;
		cleanedAt?: number;
		deferredCount: number;
		lastUpdated: number;
		notePath: string;
		noteTitle: string;
		pendingCount: number;
		unresolvedCount: number;
		rejectedCount: number;
		acceptedCount: number;
		rewrittenCount: number;
		sceneId?: string;
		status: "completed" | "cleaned" | "in_progress";
	}[];
	sweeps: ReviewSweepRegistryEntry[];
}

export interface ReviewImportSuggestionResult {
	suggestion: ReviewSuggestion;
	resolvedPath?: string;
	resolvedNoteTitle?: string;
	routeStatus: ReviewRouteStatus;
	routeStrategy: ReviewRouteStrategy;
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
	declaredCount: number;
	inferredCount: number;
	exactInferredCount: number;
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
	totalDeclaredRoutes: number;
	totalInferredRoutes: number;
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
	activeBookLabel?: string;
	activeBookSourceFolder?: string;
	cleanedAt?: number;
	editorialRevisionUpdatedNotePaths?: string[];
	importedAt: number;
	importedNotePaths: string[];
	currentNotePath?: string;
	sceneOrder: string[];
	status: ReviewSweepStatus;
	totalSuggestions: number;
	updatedAt: number;
}
