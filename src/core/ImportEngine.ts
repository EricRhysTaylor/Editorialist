import { normalizePath, TFile, type App } from "obsidian";
import {
	getSuggestionPrimaryTarget,
	isMoveSuggestion,
} from "./OperationSupport";
import { normalizeImportedReviewText, REVIEW_BLOCK_FENCE } from "./ReviewBlockFormat";
import type { MatchEngine } from "./MatchEngine";
import type { SuggestionParser } from "./SuggestionParser";
import type { ReviewImportBatch, ReviewImportNoteGroup, ReviewImportSuggestionResult, ReviewImportSummary } from "../models/ReviewImport";
import type { ParsedReviewDocument, ReviewSuggestion } from "../models/ReviewSuggestion";

interface ResolvedFileMatch {
	file?: TFile;
	reason: string;
	status: "resolved" | "mismatch" | "unresolved";
}

interface ReviewMetadata {
	model?: string;
	provider?: string;
	reviewer: string;
	reviewerType: string;
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

	async inspectBatch(rawText: string): Promise<ReviewImportBatch> {
		const normalizedBatchText = normalizeImportedReviewText(rawText) ?? rawText.trim();
		const contentHash = this.createContentHash(normalizedBatchText);
		const createdAt = Date.now();
		const parsedDocument = this.parseBatch(rawText);
		const results: ReviewImportSuggestionResult[] = [];

		for (const suggestion of parsedDocument.suggestions) {
			results.push(await this.inspectSuggestion(suggestion));
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

	private async inspectSuggestion(suggestion: ReviewSuggestion): Promise<ReviewImportSuggestionResult> {
		const resolvedFileMatch = this.resolveFileForSuggestion(suggestion);

		if (!resolvedFileMatch.file) {
			return {
				suggestion,
				routeStatus: resolvedFileMatch.status,
				routeReason: resolvedFileMatch.reason,
				verificationStatus: "note_unresolved",
				verificationReason: "Target note is unresolved.",
			};
		}

		const noteText = await this.app.vault.cachedRead(resolvedFileMatch.file);
		const matchedSuggestion = this.matchEngine.matchSuggestion(noteText, suggestion);
		const verification = this.classifyVerification(matchedSuggestion);

		return {
			suggestion: matchedSuggestion,
			resolvedPath: resolvedFileMatch.file.path,
			resolvedNoteTitle: resolvedFileMatch.file.basename,
			routeStatus: resolvedFileMatch.status,
			routeReason: resolvedFileMatch.reason,
			verificationStatus: verification.status,
			verificationReason: verification.reason,
		};
	}

	private resolveFileForSuggestion(suggestion: ReviewSuggestion): ResolvedFileMatch {
		const routing = suggestion.routing;
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const sceneId = routing?.sceneId?.trim();

		if (sceneId) {
			const sceneMatches = markdownFiles.filter((file) => this.matchesSceneId(file, sceneId));
			if (sceneMatches.length !== 1) {
				return {
					status: "unresolved",
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
					reason: `No note matches SceneId ${sceneId}.`,
				};
			}
			const mismatchReason = this.getRoutingMismatchReason(resolvedFile, suggestion);
			if (mismatchReason) {
				return {
					file: resolvedFile,
					status: "mismatch",
					reason: mismatchReason,
				};
			}

			return {
				file: resolvedFile,
				status: "resolved",
				reason: `Resolved via SceneId ${sceneId}.`,
			};
		}

		const pathMatch = this.resolvePathHint(routing?.path);
		if (pathMatch) {
			return {
				file: pathMatch,
				status: "resolved",
				reason: "Resolved via Path hint.",
			};
		}

		const noteMatch = this.resolveUniqueFileByName(routing?.note, markdownFiles);
		if (noteMatch) {
			return {
				file: noteMatch,
				status: "resolved",
				reason: "Resolved via Note hint.",
			};
		}

		const sceneMatch = this.resolveUniqueFileByName(routing?.scene, markdownFiles);
		if (sceneMatch) {
			return {
				file: sceneMatch,
				status: "resolved",
				reason: "Resolved via Scene hint.",
			};
		}

		return {
			status: "unresolved",
			reason: "No SceneId, Path, Note, or Scene hint could be resolved.",
		};
	}

	private matchesSceneId(file: TFile, sceneId: string): boolean {
		const normalizedSceneId = sceneId.trim().toLowerCase();
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		const frontmatterCandidates = [
			frontmatter?.sceneid,
			frontmatter?.sceneId,
			frontmatter?.scene_id,
		]
			.filter((value): value is string => typeof value === "string")
			.map((value) => value.trim().toLowerCase());

		return (
			frontmatterCandidates.includes(normalizedSceneId) ||
			file.basename.toLowerCase().includes(normalizedSceneId) ||
			file.path.toLowerCase().includes(normalizedSceneId)
		);
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
}
