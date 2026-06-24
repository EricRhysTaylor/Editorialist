// Decides whether an editorialism directive "relates to" the scene the author
// is currently working on, so the panel can mark those items — a geolocation
// hint for a long agenda. Scene/range matches are exact (numeric); subplot
// matches are a heuristic token overlap between the subplot name and the current
// scene's character names + subplot/action-description tokens. Manuscript/unknown
// scopes never match (they apply everywhere, so they don't help locate).

import type { EditorialismItemScope } from "../models/Editorialism";

export interface SceneRelevanceContext {
	// The current scene's number, taken from the leading integer of its file
	// name (the manuscript-numbering convention the scopes also use). Null when
	// the active file isn't number-prefixed.
	sceneNumber: number | null;
	// Lowercased word tokens (length ≥ 3) from the scene's Character + Subplot
	// + action-description frontmatter, for subplot matching.
	tokens: ReadonlySet<string>;
}

// Pull the leading integer from a file basename ("45 Cesena Scene" → 45).
export function sceneNumberFromName(basename: string): number | null {
	const match = basename.match(/^\s*(\d+)/);
	if (!match) {
		return null;
	}
	const value = Number.parseInt(match[1] ?? "", 10);
	return Number.isFinite(value) ? value : null;
}

// Tokenize frontmatter values (unwrapping `[[wikilinks]]`), keeping words ≥ 3
// chars so a 2-letter abbreviation can't accidentally match across items.
export function buildSceneTokens(values: ReadonlyArray<string>): Set<string> {
	const tokens = new Set<string>();
	for (const value of values) {
		const unlinked = value.replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1");
		for (const word of unlinked.toLowerCase().split(/[^a-z0-9]+/)) {
			if (word.length >= 3) {
				tokens.add(word);
			}
		}
	}
	return tokens;
}

export function scopeRelatesToScene(
	scope: EditorialismItemScope | null,
	context: SceneRelevanceContext,
): boolean {
	if (!scope) {
		return false;
	}

	switch (scope.kind) {
		case "scene": {
			if (context.sceneNumber === null) {
				return false;
			}
			const value = Number.parseInt(scope.scene ?? "", 10);
			return Number.isFinite(value) && value === context.sceneNumber;
		}
		case "range": {
			if (context.sceneNumber === null) {
				return false;
			}
			const start = Number.parseInt(scope.start ?? "", 10);
			const end = Number.parseInt(scope.end ?? "", 10);
			if (!Number.isFinite(start) || !Number.isFinite(end)) {
				return false;
			}
			return context.sceneNumber >= Math.min(start, end) && context.sceneNumber <= Math.max(start, end);
		}
		case "subplot": {
			if (!scope.subplotName) {
				return false;
			}
			for (const token of buildSceneTokens([scope.subplotName])) {
				if (context.tokens.has(token)) {
					return true;
				}
			}
			return false;
		}
		default:
			// manuscript / unknown — not a geolocation signal.
			return false;
	}
}
