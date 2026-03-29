import { normalizePath, TFile, type App } from "obsidian";
import {
	getSuggestionPrimaryTarget,
	isMoveSuggestion,
} from "./OperationSupport";
import { normalizeImportedReviewText, REVIEW_BLOCK_FENCE } from "./ReviewBlockFormat";
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
	reviewerType: string;
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

		for (const suggestion of parsedDocument.suggestions) {
			results.push(await this.inspectSuggestion(suggestion, markdownFiles, scopeFiles, noteTextCache));
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

			const currentText = await this.app.vault.cachedRead(file);
			const block = this.serializeGroup(batch.batchId, group);
			const nextText = this.appendImportBlock(currentText, block);
			await this.app.vault.modify(file, nextText);
			importedGroups.push(group);
		}

		return importedGroups;
	}

	private async inspectSuggestion(
		suggestion: ReviewSuggestion,
		markdownFiles: TFile[],
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
	): Promise<ReviewImportSuggestionResult> {
		const resolvedFileMatch = await this.resolveFileForSuggestion(
			suggestion,
			markdownFiles,
			scopeFiles,
			noteTextCache,
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
	): Promise<ResolvedFileMatch> {
		const routing = suggestion.routing;
		const sceneId = routing?.sceneId?.trim();

		if (sceneId) {
			const sceneMatches = markdownFiles.filter((file) => this.matchesSceneId(file, sceneId));
			if (sceneMatches.length !== 1) {
				return {
					status: "unresolved",
					strategy: "declared_scene_id",
					reason:
						sceneMatches.length > 1
							? `Multiple notes match SceneId ${sceneId}.`
							: `No note matches SceneId ${sceneId}.`,
				};
			}

			const resolvedFile = sceneMatches[0];
			if (!resolvedFile) {
				return {
					status: "unresolved",
					strategy: "declared_scene_id",
					reason: `No note matches SceneId ${sceneId}.`,
				};
			}
			const mismatchReason = this.getRoutingMismatchReason(resolvedFile, suggestion);
			if (mismatchReason) {
				return {
					file: resolvedFile,
					status: "mismatch",
					strategy: "declared_scene_id",
					reason: mismatchReason,
				};
			}

			return {
				file: resolvedFile,
				status: "resolved",
				strategy: "declared_scene_id",
				reason: `Resolved via SceneId ${sceneId}.`,
			};
		}

		const pathMatch = this.resolvePathHint(routing?.path);
		if (pathMatch) {
			return {
				file: pathMatch,
				status: "resolved",
				strategy: "declared_path",
				reason: "Resolved via Path hint.",
			};
		}

		const noteMatch = this.resolveUniqueFileByName(routing?.note, markdownFiles);
		if (noteMatch) {
			return {
				file: noteMatch,
				status: "resolved",
				strategy: "declared_note",
				reason: "Resolved via Note hint.",
			};
		}

		const sceneMatch = this.resolveUniqueFileByName(routing?.scene, markdownFiles);
		if (sceneMatch) {
			return {
				file: sceneMatch,
				status: "resolved",
				strategy: "declared_scene",
				reason: "Resolved via Scene hint.",
			};
		}

		const inferredMatch = await this.inferFileForSuggestion(suggestion, scopeFiles, noteTextCache);
		if (inferredMatch) {
			return inferredMatch;
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

	private async getActiveBookScopeFiles(activeNotePath: string | undefined, markdownFiles: TFile[]): Promise<TFile[]> {
		const scopeRoot = (await this.getRadialTimelineActiveBookSourceFolder()) ?? this.getActiveNoteScopeRoot(activeNotePath);
		if (!scopeRoot) {
			return [];
		}

		return markdownFiles.filter(
			(file) => this.isPathInFolderScope(file.path, scopeRoot) && this.isSceneClassFile(file),
		);
	}

	private getActiveNoteScopeRoot(activeNotePath: string | undefined): string | null {
		if (!activeNotePath) {
			return null;
		}

		const normalizedActivePath = normalizePath(activeNotePath);
		const lastSlashIndex = normalizedActivePath.lastIndexOf("/");
		if (lastSlashIndex === -1) {
			return "";
		}

		return normalizedActivePath.slice(0, lastSlashIndex);
	}

	private isPathInFolderScope(filePath: string, scopeRoot: string): boolean {
		const normalizedScopeRoot = normalizePath(scopeRoot);
		const normalizedFilePath = normalizePath(filePath);
		if (!normalizedScopeRoot) {
			return !normalizedFilePath.includes("/");
		}

		return normalizedFilePath === normalizedScopeRoot || normalizedFilePath.startsWith(`${normalizedScopeRoot}/`);
	}

	private isSceneClassFile(file: TFile): boolean {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const classValues = this.getFrontmatterStringValues(frontmatter, ["class", "Class", "classes", "Classes"]);

		return classValues.some((value) => this.normalizeMetadataValue(value) === "scene");
	}

	private normalizeMetadataValue(value: unknown): string {
		return typeof value === "string" ? value.trim().toLowerCase() : "";
	}

	private async getRadialTimelineActiveBookSourceFolder(): Promise<string | null> {
		try {
			const radialDataPath = normalizePath(`${this.app.vault.configDir}/plugins/radial-timeline/data.json`);
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(radialDataPath))) {
				return null;
			}

			const raw = await adapter.read(radialDataPath);
			const parsed = JSON.parse(raw) as {
				activeBookId?: string;
				books?: Array<{ id?: string; sourceFolder?: string }>;
			};
			const books = Array.isArray(parsed.books) ? parsed.books : [];
			const activeBookId = typeof parsed.activeBookId === "string" ? parsed.activeBookId : "";
			const activeBook = books.find((book) => book.id === activeBookId) ?? books[0];
			const sourceFolder = activeBook?.sourceFolder?.trim();
			return sourceFolder ? normalizePath(sourceFolder) : null;
		} catch {
			return null;
		}
	}

	private matchesSceneId(file: TFile, sceneId: string): boolean {
		const normalizedSceneId = sceneId.trim().toLowerCase();
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		const frontmatterCandidates = this.getFrontmatterStringValues(frontmatter, [
			"id",
			"Id",
			"ID",
			"sceneid",
			"sceneId",
			"SceneId",
			"scene_id",
			"Scene_ID",
		]).map((value) => value.trim().toLowerCase());

		return (
			frontmatterCandidates.includes(normalizedSceneId) ||
			file.basename.toLowerCase().includes(normalizedSceneId) ||
			file.path.toLowerCase().includes(normalizedSceneId)
		);
	}

	private getFrontmatterStringValues(frontmatter: Record<string, unknown> | undefined, keys: string[]): string[] {
		if (!frontmatter) {
			return [];
		}

		return keys.flatMap((key) => {
			const value = frontmatter[key];
			if (Array.isArray(value)) {
				return value.filter((item): item is string => typeof item === "string");
			}
			return typeof value === "string" ? [value] : [];
		});
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
		noteTextCache.set(file.path, noteText);
		return noteText;
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
			reviewer: raw?.rawName?.trim() || firstSuggestion?.contributor.displayName || "Editorialist",
			reviewerType: raw?.rawType?.trim() || firstSuggestion?.contributor.kind || "editor",
			provider: raw?.rawProvider?.trim() || firstSuggestion?.contributor.provider,
			model: raw?.rawModel?.trim() || firstSuggestion?.contributor.model,
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
		if (!text) {
			return [];
		}

		const matches: number[] = [];
		let searchFrom = 0;

		while (searchFrom < noteText.length) {
			const index = noteText.indexOf(text, searchFrom);
			if (index === -1) {
				break;
			}

			matches.push(index);
			searchFrom = index + text.length;
		}

		return matches;
	}

	private findAllNormalizedMatches(noteText: string, text: string): number {
		const normalizedText = this.matchEngine.normalizeText(noteText);
		const normalizedTarget = this.matchEngine.normalizeText(text);
		if (!normalizedText || !normalizedTarget) {
			return 0;
		}

		let count = 0;
		let searchFrom = 0;
		while (searchFrom < normalizedText.length) {
			const index = normalizedText.indexOf(normalizedTarget, searchFrom);
			if (index === -1) {
				break;
			}
			count += 1;
			searchFrom = index + normalizedTarget.length;
		}

		return count;
	}
}
