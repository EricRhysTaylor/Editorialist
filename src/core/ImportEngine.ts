import { normalizePath, TFile, type App } from "obsidian";
import {
	getSuggestionPrimaryTarget,
	isMoveSuggestion,
} from "./OperationSupport";
import { normalizeImportedReviewText, REVIEW_BLOCK_FENCE, stripAllReviewBlocks } from "./ReviewBlockFormat";
import {
	getActiveNoteScopeRoot,
	isPathInFolderScope,
	isSceneClassFile,
	matchesSceneId,
	readRadialTimelineActiveBookScope,
} from "./VaultScope";
import { countNormalizedMatches, findExactMatches } from "./TextMatching";
import type { MatchEngine } from "./MatchEngine";
import type { SuggestionParser } from "./SuggestionParser";
import type {
	ReviewImportBatch,
	ReviewImportNoteGroup,
	ReviewImportSuggestionResult,
	ReviewImportSummary,
	ReviewRouteStrategy,
} from "../models/ReviewImport";
import type { ParsedReviewDocument, ReviewSuggestion, SupportedReviewOperationType } from "../models/ReviewSuggestion";

interface ResolvedFileMatch {
	file?: TFile;
	reason: string;
	status: "resolved" | "mismatch" | "unresolved";
	strategy: ReviewRouteStrategy;
}

interface ReviewMetadata {
	model?: string;
	provider?: string;
	reviewer: string;
	reviewerType: ReviewSuggestion["contributor"]["reviewerType"];
}

interface InspectBatchOptions {
	activeNotePath?: string;
}

interface TextMatchCounts {
	exactCount: number;
	normalizedCount: number;
}

export class ImportEngine {
	constructor(
		private readonly app: App,
		private readonly parser: SuggestionParser,
		private readonly matchEngine: MatchEngine,
	) {}

	parseBatch(rawText: string): ParsedReviewDocument {
		const normalizedText = normalizeImportedReviewText(rawText);
		return this.parser.parse(normalizedText ?? rawText);
	}

	async inspectBatch(rawText: string, options?: InspectBatchOptions): Promise<ReviewImportBatch> {
		const normalizedBatchText = normalizeImportedReviewText(rawText) ?? rawText.trim();
		const contentHash = this.createContentHash(normalizedBatchText);
		const createdAt = Date.now();
		const parsedDocument = this.parseBatch(rawText);
		const results: ReviewImportSuggestionResult[] = [];
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const scopeFiles = await this.getActiveBookScopeFiles(options?.activeNotePath, markdownFiles);
		const noteTextCache = new Map<string, string>();

		const activeNotePath = options?.activeNotePath;
		for (const suggestion of parsedDocument.suggestions) {
			results.push(
				await this.inspectSuggestion(suggestion, markdownFiles, scopeFiles, noteTextCache, activeNotePath),
			);
		}

		const groups = this.buildGroups(results);
		const summary = this.buildSummary(results, groups);

		return {
			batchId: `batch-${createdAt.toString(36)}-${contentHash.slice(0, 8)}`,
			contentHash,
			createdAt,
			rawText,
			results,
			groups,
			summary,
		};
	}

	async importBatch(batch: ReviewImportBatch): Promise<ReviewImportNoteGroup[]> {
		const importedGroups: ReviewImportNoteGroup[] = [];

		for (const group of batch.groups) {
			if (!group.isReady) {
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(group.filePath);
			if (!(file instanceof TFile)) {
				continue;
			}

			const block = this.serializeGroup(batch.batchId, group);
			await this.app.vault.process(file, (currentText) => this.appendImportBlock(currentText, block));
			importedGroups.push(group);
		}

		return importedGroups;
	}

	private async inspectSuggestion(
		suggestion: ReviewSuggestion,
		markdownFiles: TFile[],
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
		activeNotePath?: string,
	): Promise<ReviewImportSuggestionResult> {
		const resolvedFileMatch = await this.resolveFileForSuggestion(
			suggestion,
			markdownFiles,
			scopeFiles,
			noteTextCache,
			activeNotePath,
		);

		if (!resolvedFileMatch.file) {
			return {
				suggestion,
				routeStatus: resolvedFileMatch.status,
				routeStrategy: resolvedFileMatch.strategy,
				routeReason: resolvedFileMatch.reason,
				verificationStatus: "note_unresolved",
				verificationReason: "Target note is unresolved.",
			};
		}

		const noteText = await this.readNoteText(resolvedFileMatch.file, noteTextCache);
		const matchedSuggestion = this.matchEngine.matchSuggestion(noteText, suggestion);
		const verification = this.classifyVerification(matchedSuggestion);

		return {
			suggestion: matchedSuggestion,
			resolvedPath: resolvedFileMatch.file.path,
			resolvedNoteTitle: resolvedFileMatch.file.basename,
			routeStatus: resolvedFileMatch.status,
			routeStrategy: resolvedFileMatch.strategy,
			routeReason: resolvedFileMatch.reason,
			verificationStatus: verification.status,
			verificationReason: verification.reason,
		};
	}

	private async resolveFileForSuggestion(
		suggestion: ReviewSuggestion,
		markdownFiles: TFile[],
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
		activeNotePath?: string,
	): Promise<ResolvedFileMatch> {
		const routing = suggestion.routing;
		const sceneId = routing?.sceneId?.trim();
		let sceneIdFailureReason: string | null = null;

		if (sceneId) {
			const sceneMatches = markdownFiles.filter((file) => this.matchesSceneId(file, sceneId));
			if (sceneMatches.length > 1) {
				sceneIdFailureReason = `Multiple notes match SceneId ${sceneId}.`;
			} else if (sceneMatches.length === 0) {
				sceneIdFailureReason = `No note matches SceneId ${sceneId}.`;
			}

			const resolvedFile = sceneMatches[0];
			if (resolvedFile) {
				const mismatchReason = this.getRoutingMismatchReason(resolvedFile, suggestion);
				if (!mismatchReason) {
					return {
						file: resolvedFile,
						status: "resolved",
						strategy: "declared_scene_id",
						reason: `Resolved via SceneId ${sceneId}.`,
					};
				}

				sceneIdFailureReason = mismatchReason;
			}
		}

		const pathMatch = this.resolvePathHint(routing?.path);
		if (pathMatch) {
			return {
				file: pathMatch,
				status: "resolved",
				strategy: "declared_path",
				reason: this.combineRoutingReasons(
					sceneIdFailureReason,
					"Resolved via Path hint.",
				),
			};
		}

		const noteMatch = this.resolveUniqueFileByName(routing?.note, markdownFiles);
		if (noteMatch) {
			return {
				file: noteMatch,
				status: "resolved",
				strategy: "declared_note",
				reason: this.combineRoutingReasons(
					sceneIdFailureReason,
					"Resolved via Note hint.",
				),
			};
		}

		const sceneMatch = this.resolveUniqueFileByName(routing?.scene, markdownFiles);
		if (sceneMatch) {
			return {
				file: sceneMatch,
				status: "resolved",
				strategy: "declared_scene",
				reason: this.combineRoutingReasons(
					sceneIdFailureReason,
					"Resolved via Scene hint.",
				),
			};
		}

		const inferredMatch = await this.inferFileForSuggestion(suggestion, scopeFiles, noteTextCache);
		if (inferredMatch) {
			return {
				...inferredMatch,
				reason: this.combineRoutingReasons(sceneIdFailureReason, inferredMatch.reason),
			};
		}

		// Fallback: use the active note when nothing else routes the suggestion.
		// Common case: AI emits descriptive Targets for CONDENSE/CUT/MOVE that don't anchor in scene text,
		// or hallucinated SceneIds. The user is reviewing the active scene — route the suggestion there
		// so it surfaces in the embed and side panel as advisory rather than getting silently dropped.
		const activeFallback = this.resolveActiveNoteFallback(activeNotePath, scopeFiles);
		if (activeFallback) {
			return {
				file: activeFallback,
				status: "resolved",
				strategy: "fallback_active_note",
				reason: this.combineRoutingReasons(
					sceneIdFailureReason,
					`Routed to the active note (${activeFallback.basename}) as a fallback; verify the suggestion manually.`,
				),
			};
		}

		if (sceneIdFailureReason) {
			return {
				status: "unresolved",
				strategy: "declared_scene_id",
				reason: this.combineRoutingReasons(
					sceneIdFailureReason,
					scopeFiles.length > 0
						? "No Path, Note, or safe inferred scene match could be resolved."
						: "No Path or Note hint could be resolved, and no active-book scene scope was available for inferred matching.",
				),
			};
		}

		return {
			status: "unresolved",
			strategy: "unresolved",
			reason:
				scopeFiles.length > 0
					? "No SceneId, Path, Note, or safe inferred scene match could be resolved."
					: "No SceneId, Path, or Note hint could be resolved, and no active-book scene scope was available for inferred matching.",
		};
	}

	private resolveActiveNoteFallback(activeNotePath: string | undefined, scopeFiles: TFile[]): TFile | null {
		if (!activeNotePath) {
			return null;
		}
		const file = this.app.vault.getAbstractFileByPath(activeNotePath);
		if (!(file instanceof TFile)) {
			return null;
		}
		// Restrict to scene-class files inside the active book scope when scope is known.
		if (scopeFiles.length > 0 && !scopeFiles.some((scope) => scope.path === file.path)) {
			return null;
		}
		if (scopeFiles.length === 0 && !isSceneClassFile(this.app, file)) {
			return null;
		}
		return file;
	}

	private combineRoutingReasons(primary: string | null | undefined, fallback: string): string {
		if (!primary?.trim()) {
			return fallback;
		}

		return `${primary} ${fallback}`;
	}

	private async getActiveBookScopeFiles(activeNotePath: string | undefined, markdownFiles: TFile[]): Promise<TFile[]> {
		const scopeRoot = (await this.getRadialTimelineActiveBookSourceFolder()) ?? getActiveNoteScopeRoot(activeNotePath);
		if (!scopeRoot) {
			return [];
		}

		return markdownFiles.filter(
			(file) => isPathInFolderScope(file.path, scopeRoot) && isSceneClassFile(this.app, file),
		);
	}

	private async getRadialTimelineActiveBookSourceFolder(): Promise<string | null> {
		return (await readRadialTimelineActiveBookScope(this.app)).sourceFolder;
	}

	private matchesSceneId(file: TFile, sceneId: string): boolean {
		return matchesSceneId(this.app, file, sceneId);
	}

	private getRoutingMismatchReason(file: TFile, suggestion: ReviewSuggestion): string | null {
		const pathHint = suggestion.routing?.path?.trim();
		if (pathHint) {
			const normalizedHint = normalizePath(pathHint);
			if (normalizePath(file.path) !== normalizedHint) {
				return `SceneId resolves to ${file.basename}, but Path points to ${normalizedHint}.`;
			}
		}

		const noteHint = suggestion.routing?.note?.trim();
		if (noteHint && file.basename !== noteHint) {
			return `SceneId resolves to ${file.basename}, but Note says ${noteHint}.`;
		}

		const sceneHint = suggestion.routing?.scene?.trim();
		if (sceneHint && file.basename !== sceneHint) {
			return `SceneId resolves to ${file.basename}, but Scene says ${sceneHint}.`;
		}

		return null;
	}

	private resolvePathHint(pathHint?: string): TFile | null {
		if (!pathHint?.trim()) {
			return null;
		}

		const abstractFile = this.app.vault.getAbstractFileByPath(normalizePath(pathHint.trim()));
		return abstractFile instanceof TFile ? abstractFile : null;
	}

	private resolveUniqueFileByName(name: string | undefined, files: TFile[]): TFile | null {
		if (!name?.trim()) {
			return null;
		}

		const normalizedName = name.trim().toLowerCase();
		const matches = files.filter(
			(file) =>
				file.basename.toLowerCase() === normalizedName ||
				file.path.toLowerCase() === normalizedName,
		);

		return matches.length === 1 ? (matches[0] ?? null) : null;
	}

	private async inferFileForSuggestion(
		suggestion: ReviewSuggestion,
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
	): Promise<ResolvedFileMatch | null> {
		if (scopeFiles.length === 0) {
			return null;
		}

		const inferredText = this.getInferredRoutingText(suggestion);
		if (!inferredText?.trim()) {
			return {
				status: "unresolved",
				strategy: "unresolved",
				reason:
					suggestion.operation === "move"
						? "Move suggestion could not be inferred safely from target and anchor text."
						: "No routing hint or inferable source text was available.",
			};
		}

		const exactMatches = await this.findExactInferenceMatches(suggestion, scopeFiles, noteTextCache);
		if (exactMatches.length === 1) {
			const resolvedFile = exactMatches[0];
			if (!resolvedFile) {
				return null;
			}
			return {
				file: resolvedFile,
				status: "resolved",
				strategy: "inferred_exact",
				reason: `Resolved via exact inferred text match in ${resolvedFile.basename}.`,
			};
		}

		if (exactMatches.length > 1) {
			return {
				status: "unresolved",
				strategy: "inferred_exact",
				reason: `${exactMatches.length} scene notes in the active book contain the exact ${this.getInferredTargetLabel(suggestion.operation)} text.`,
			};
		}

		const normalizedMatches = await this.findNormalizedInferenceMatches(suggestion, scopeFiles, noteTextCache);
		if (normalizedMatches.length === 1) {
			const normalizedFile = normalizedMatches[0];
			if (!normalizedFile) {
				return null;
			}
			return {
				status: "unresolved",
				strategy: "inferred_normalized",
				reason: `Normalized text suggests ${normalizedFile.basename}, but the exact text was not found safely.`,
			};
		}

		if (normalizedMatches.length > 1) {
			return {
				status: "unresolved",
				strategy: "inferred_normalized",
				reason: `Normalized text matches ${normalizedMatches.length} scene notes in the active book.`,
			};
		}

		return null;
	}

	private getInferredRoutingText(suggestion: ReviewSuggestion): string | null {
		switch (suggestion.operation) {
			case "edit":
				return suggestion.payload.original;
			case "cut":
				return suggestion.payload.target;
			case "condense":
				return suggestion.payload.target;
			case "move":
				return suggestion.payload.target;
			default:
				return null;
		}
	}

	private getInferredTargetLabel(operation: SupportedReviewOperationType): string {
		switch (operation) {
			case "edit":
				return "original";
			case "cut":
			case "condense":
				return "target";
			case "move":
				return "target and anchor";
		}
	}

	private async findExactInferenceMatches(
		suggestion: ReviewSuggestion,
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
	): Promise<TFile[]> {
		const matches: TFile[] = [];

		for (const file of scopeFiles) {
			const noteText = await this.readNoteText(file, noteTextCache);
			const counts = this.getSuggestionMatchCounts(noteText, suggestion);
			if (this.isSafeExactInferenceMatch(suggestion, counts)) {
				matches.push(file);
			}
		}

		return matches;
	}

	private async findNormalizedInferenceMatches(
		suggestion: ReviewSuggestion,
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
	): Promise<TFile[]> {
		const matches: TFile[] = [];

		for (const file of scopeFiles) {
			const noteText = await this.readNoteText(file, noteTextCache);
			if (this.hasNormalizedInferenceMatch(noteText, suggestion)) {
				matches.push(file);
			}
		}

		return matches;
	}

	private getSuggestionMatchCounts(noteText: string, suggestion: ReviewSuggestion): TextMatchCounts {
		switch (suggestion.operation) {
			case "edit":
				return {
						exactCount: this.findAllExactMatches(noteText, suggestion.payload.original).length,
						normalizedCount: this.findAllNormalizedMatches(noteText, suggestion.payload.original),
				};
			case "cut":
				return {
					exactCount: this.findAllExactMatches(noteText, suggestion.payload.target).length,
					normalizedCount: this.findAllNormalizedMatches(noteText, suggestion.payload.target),
				};
			case "condense":
				return {
					exactCount: this.findAllExactMatches(noteText, suggestion.payload.target).length,
					normalizedCount: this.findAllNormalizedMatches(noteText, suggestion.payload.target),
				};
			case "move": {
				const targetExactCount = this.findAllExactMatches(noteText, suggestion.payload.target).length;
				const anchorExactCount = this.findAllExactMatches(noteText, suggestion.payload.anchor).length;
				const targetNormalizedCount = this.findAllNormalizedMatches(noteText, suggestion.payload.target);
				const anchorNormalizedCount = this.findAllNormalizedMatches(noteText, suggestion.payload.anchor);
				return {
					exactCount: targetExactCount === 1 && anchorExactCount === 1 ? 1 : 0,
					normalizedCount: targetNormalizedCount === 1 && anchorNormalizedCount === 1 ? 1 : 0,
				};
			}
		}
	}

	private isSafeExactInferenceMatch(
		suggestion: ReviewSuggestion,
		matchCounts: TextMatchCounts,
	): boolean {
		if (suggestion.operation === "move") {
			return matchCounts.exactCount === 1;
		}

		return matchCounts.exactCount === 1;
	}

	private hasNormalizedInferenceMatch(noteText: string, suggestion: ReviewSuggestion): boolean {
		const counts = this.getSuggestionMatchCounts(noteText, suggestion);
		return counts.exactCount === 0 && counts.normalizedCount === 1;
	}

	private async readNoteText(file: TFile, noteTextCache: Map<string, string>): Promise<string> {
		const cached = noteTextCache.get(file.path);
		if (cached !== undefined) {
			return cached;
		}

		const noteText = await this.app.vault.cachedRead(file);
		const matchableText = stripAllReviewBlocks(noteText).text;
		noteTextCache.set(file.path, matchableText);
		return matchableText;
	}

	private classifyVerification(suggestion: ReviewSuggestion): { reason: string; status: ReviewImportSuggestionResult["verificationStatus"] } {
		if (suggestion.executionMode === "advisory") {
			return {
				status: "advisory",
				reason: "Advisory-only suggestion.",
			};
		}

		if (isMoveSuggestion(suggestion)) {
			const target = suggestion.location.target;
			const anchor = suggestion.location.anchor;
			if (suggestion.location.relocation?.canApply) {
				return {
					status: "exact",
					reason: "Target and anchor both resolved exactly.",
				};
			}

			if (target?.matchType === "multiple" || anchor?.matchType === "multiple") {
				return {
					status: "multiple",
					reason: suggestion.location.relocation?.reason ?? "Move resolution is ambiguous.",
				};
			}

			return {
				status: "none",
				reason: suggestion.location.relocation?.reason ?? "Move resolution failed.",
			};
		}

		const primary = getSuggestionPrimaryTarget(suggestion);
		if (primary?.matchType === "exact") {
			return {
				status: "exact",
				reason: primary.reason ?? "Exact match found.",
			};
		}

		if (primary?.matchType === "multiple") {
			return {
				status: "multiple",
				reason: primary.reason ?? "Multiple matches found.",
			};
		}

		return {
			status: "none",
			reason: primary?.reason ?? "No exact match found.",
		};
	}

	private buildGroups(results: ReviewImportSuggestionResult[]): ReviewImportNoteGroup[] {
		const groupsByPath = new Map<string, ReviewImportSuggestionResult[]>();

		for (const result of results) {
			if (!result.resolvedPath) {
				continue;
			}

			const existing = groupsByPath.get(result.resolvedPath) ?? [];
			existing.push(result);
			groupsByPath.set(result.resolvedPath, existing);
		}

		return [...groupsByPath.entries()]
			.map(([filePath, suggestionResults]) => {
				const first = suggestionResults[0];
				const exactCount = suggestionResults.filter((result) => result.verificationStatus === "exact").length;
				const declaredCount = suggestionResults.filter((result) => result.routeStrategy.startsWith("declared_")).length;
				const inferredCount = suggestionResults.filter((result) => result.routeStrategy === "inferred_exact").length;
				const exactInferredCount = suggestionResults.filter(
					(result) => result.routeStrategy === "inferred_exact" && result.verificationStatus === "exact",
				).length;
				const advisoryCount = suggestionResults.filter((result) => result.verificationStatus === "advisory").length;
				const unresolvedCount = suggestionResults.filter(
					(result) =>
						result.verificationStatus === "multiple" ||
						result.verificationStatus === "none" ||
						result.verificationStatus === "note_unresolved",
				).length;
				const mismatchCount = suggestionResults.filter((result) => result.routeStatus === "mismatch").length;

				return {
					filePath,
					fileName: first?.resolvedNoteTitle ?? filePath,
					sceneId: first?.suggestion.routing?.sceneId,
					suggestions: suggestionResults,
					exactCount,
					declaredCount,
					inferredCount,
					exactInferredCount,
					advisoryCount,
					unresolvedCount,
					mismatchCount,
					isReady: suggestionResults.every((result) => result.routeStatus === "resolved"),
				};
			});
	}

	private buildSummary(results: ReviewImportSuggestionResult[], groups: ReviewImportNoteGroup[]): ReviewImportSummary {
		return {
			totalSuggestions: results.length,
			totalMatchedScenes: groups.length,
			totalResolvedScenes: groups.filter((group) => group.isReady).length,
			totalUnresolvedScenes: new Set(
				results
					.filter((result) => result.routeStatus !== "resolved")
					.map((result) => result.suggestion.routing?.sceneId ?? result.suggestion.id),
			).size,
			totalMismatches: results.filter((result) => result.routeStatus === "mismatch").length,
			totalExactMatches: results.filter((result) => result.verificationStatus === "exact").length,
			totalDeclaredRoutes: results.filter((result) => result.routeStrategy.startsWith("declared_")).length,
			totalInferredRoutes: results.filter((result) => result.routeStrategy === "inferred_exact").length,
			totalAdvisoryOnly: results.filter((result) => result.verificationStatus === "advisory").length,
			totalUnresolvedMatches: results.filter(
				(result) =>
					result.verificationStatus === "multiple" ||
					result.verificationStatus === "none" ||
					result.verificationStatus === "note_unresolved",
			).length,
		};
	}

	private serializeGroup(batchId: string, group: ReviewImportNoteGroup): string {
		const metadata = this.extractMetadata(group.suggestions);
		const lines: string[] = [`\`\`\`${REVIEW_BLOCK_FENCE}`];

		lines.push(`BatchId: ${batchId}`);
		lines.push("ImportedBy: Editorialist");
		lines.push(`Reviewer: ${metadata.reviewer}`);
		lines.push(`ReviewerType: ${metadata.reviewerType}`);

		if (metadata.provider) {
			lines.push(`Provider: ${metadata.provider}`);
		}

		if (metadata.model) {
			lines.push(`Model: ${metadata.model}`);
		}

		for (const result of group.suggestions) {
			lines.push("");
			lines.push(`=== ${result.suggestion.operation.toUpperCase()} ===`);

			const routing = result.suggestion.routing;
			if (routing?.sceneId) {
				lines.push(`SceneId: ${routing.sceneId}`);
			}

			if (routing?.note) {
				lines.push(`Note: ${routing.note}`);
			}

			if (routing?.path) {
				lines.push(`Path: ${routing.path}`);
			}

			switch (result.suggestion.operation) {
				case "edit":
					lines.push(`Original: ${result.suggestion.payload.original}`);
					lines.push(`Revised: ${result.suggestion.payload.revised}`);
					break;
				case "cut":
					lines.push(`Target: ${result.suggestion.payload.target}`);
					break;
				case "condense":
					lines.push(`Target: ${result.suggestion.payload.target}`);
					if (result.suggestion.payload.suggestion) {
						lines.push(`Suggestion: ${result.suggestion.payload.suggestion}`);
					}
					break;
				case "move":
					lines.push(`Target: ${result.suggestion.payload.target}`);
					lines.push(
						`${result.suggestion.payload.placement === "after" ? "After" : "Before"}: ${result.suggestion.payload.anchor}`,
					);
					break;
			}

			if (result.suggestion.why) {
				lines.push(`Why: ${result.suggestion.why}`);
			}
		}

		lines.push("```");
		return lines.join("\n");
	}

	private extractMetadata(results: ReviewImportSuggestionResult[]): ReviewMetadata {
		const firstSuggestion = results[0]?.suggestion;
		const raw = firstSuggestion?.contributor.raw;

		return {
			reviewer: firstSuggestion?.contributor.displayName || raw?.rawName?.trim() || "Unknown contributor",
			reviewerType: firstSuggestion?.contributor.reviewerType ?? "author",
			provider: firstSuggestion?.contributor.provider ?? raw?.rawProvider?.trim(),
			model: firstSuggestion?.contributor.model ?? raw?.rawModel?.trim(),
		};
	}

	private appendImportBlock(currentText: string, block: string): string {
		const trimmedText = currentText.trimEnd();
		return trimmedText.length > 0 ? `${trimmedText}\n\n${block}\n` : `${block}\n`;
	}

	private createContentHash(value: string): string {
		let hash = 2166136261;
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}

		return (hash >>> 0).toString(16).padStart(8, "0");
	}

	private findAllExactMatches(noteText: string, text: string): number[] {
		return findExactMatches(noteText, text);
	}

	private findAllNormalizedMatches(noteText: string, text: string): number {
		return countNormalizedMatches(noteText, text);
	}
}
