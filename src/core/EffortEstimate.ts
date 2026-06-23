// Revision-effort estimate for an editorialism (the structural agenda).
//
// Translates the open directives in an editorialism into an approximate
// authoring-time figure — the *new prose* the revisions imply, not the seconds
// it takes to click "accept". Two effort kinds per item:
//   - drafting work: new scenes / added words, costed at a configurable
//     words-per-hour drafting rate (creative drafting, not typing speed).
//   - directive work: restructure / line-level / doctrinal items, costed at a
//     per-directive base weighted by scope (a manuscript-wide directive is
//     heavier than a single-scene one).
//
// Item effort is read from explicit inline annotations when present
// (`[words:: N]`, `[scenes:: N]`, `[effort:: tier]`); otherwise it falls back
// to scope-weighted heuristics plus a light "new scene" keyword scan. Explicit
// annotations are always preferred — the estimate gets sharper as the agenda
// carries them.

import type {
	Editorialism,
	EditorialismEffortTier,
	EditorialismItem,
	EditorialismItemStatus,
	EditorialismScopeKind,
} from "../models/Editorialism";
import type { EditorialistEffortSettings } from "../models/ContributorProfile";

export interface EffortParams {
	/** Assumed words in a freshly drafted scene when only a scene count is known. */
	wordsPerNewScene: number;
	/** Creative drafting rate (NOT typing speed) — words produced per hour. */
	draftRateWordsPerHour: number;
	/** Base minutes for a non-drafting directive before scope/tier weighting. */
	minutesPerDirective: number;
	/** Per-scope multiplier on directive minutes. */
	scopeWeight: Record<EditorialismScopeKind, number>;
	/** Per-tier multiplier when an item declares `[effort:: …]`. */
	tierWeight: Record<EditorialismEffortTier, number>;
	/** Writing time the author expects to spend per day, for the session estimate. */
	dailyWritingHours: number;
}

export const DEFAULT_EFFORT_PARAMS: EffortParams = {
	wordsPerNewScene: 1500,
	// Realistic first-draft fiction rate, not transcription. Configurable.
	draftRateWordsPerHour: 750,
	minutesPerDirective: 12,
	scopeWeight: { scene: 1, range: 1, arc: 3, manuscript: 4, unknown: 1 },
	tierWeight: { light: 0.5, medium: 1, heavy: 2.5 },
	dailyWritingHours: 2,
};

export interface EffortEstimate {
	actionableItems: number;
	newScenes: number;
	newWords: number;
	draftingMinutes: number;
	directiveItems: number;
	directiveMinutes: number;
	totalMinutes: number;
	/** Whole sessions at the configured daily writing budget (rounded up). */
	sessions: number;
}

// Settled items carry no remaining work.
function isActionable(status: EditorialismItemStatus): boolean {
	return status !== "done" && status !== "deferred";
}

const NUMBER_WORDS: Record<string, number> = {
	a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
	six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// Conservative fallback when an item has no explicit scene/word annotation:
// recognise "<count> … new/added scene(s)" and pull the count, else 0.
function detectNewScenes(text: string): number {
	const match = text.match(
		/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:new\s+|additional\s+|present-tense\s+|flashback\s+)*scenes?\b/i,
	);
	if (match) {
		const token = (match[1] ?? "").toLowerCase();
		const n = NUMBER_WORDS[token] ?? Number.parseInt(token, 10);
		return Number.isFinite(n) && n > 0 ? n : 0;
	}
	// "a new scene" / "new scene" / "add a scene" with no leading count.
	if (/\b(?:new|add(?:ing)?|write|draft)\b[^.]*\bscenes?\b/i.test(text)) {
		return 1;
	}
	return 0;
}

function rangeSceneCount(item: EditorialismItem): number {
	const scope = item.scope;
	if (!scope || scope.kind !== "range") {
		return 1;
	}
	const start = Number.parseInt(scope.start ?? "", 10);
	const end = Number.parseInt(scope.end ?? "", 10);
	if (!Number.isFinite(start) || !Number.isFinite(end)) {
		return 1;
	}
	return Math.min(100, Math.max(1, end - start + 1));
}

function draftingWordsFor(item: EditorialismItem, params: EffortParams): { words: number; scenes: number } {
	const effort = item.effort;
	if (effort?.words !== undefined) {
		return { words: effort.words, scenes: effort.scenes ?? 0 };
	}
	if (effort?.scenes !== undefined) {
		return { words: effort.scenes * params.wordsPerNewScene, scenes: effort.scenes };
	}
	const scenes = detectNewScenes(item.text);
	return { words: scenes * params.wordsPerNewScene, scenes };
}

export function estimateEditorialismEffort(
	editorialism: Editorialism,
	params: EffortParams = DEFAULT_EFFORT_PARAMS,
): EffortEstimate {
	let actionableItems = 0;
	let newScenes = 0;
	let newWords = 0;
	let draftingMinutes = 0;
	let directiveItems = 0;
	let directiveMinutes = 0;

	for (const section of editorialism.sections) {
		for (const item of section.items) {
			if (!isActionable(item.status)) {
				continue;
			}
			actionableItems += 1;

			const { words, scenes } = draftingWordsFor(item, params);
			if (words > 0) {
				newScenes += scenes;
				newWords += words;
				draftingMinutes += (words / params.draftRateWordsPerHour) * 60;
				continue;
			}

			// Non-drafting directive: scope-weighted base, optionally tier-scaled.
			directiveItems += 1;
			const scopeKind = item.scope?.kind ?? "unknown";
			const scopeFactor = (params.scopeWeight[scopeKind] ?? 1) * rangeSceneCount(item);
			const tierFactor = item.effort?.tier ? params.tierWeight[item.effort.tier] : 1;
			directiveMinutes += params.minutesPerDirective * scopeFactor * tierFactor;
		}
	}

	const totalMinutes = Math.round(draftingMinutes + directiveMinutes);
	const perSession = Math.max(1, params.dailyWritingHours * 60);
	const sessions = totalMinutes > 0 ? Math.ceil(totalMinutes / perSession) : 0;

	return {
		actionableItems,
		newScenes,
		newWords,
		draftingMinutes: Math.round(draftingMinutes),
		directiveItems,
		directiveMinutes: Math.round(directiveMinutes),
		totalMinutes,
		sessions,
	};
}

// Combine the author-tunable settings with the code-default scope/tier weights.
export function effortParamsFromSettings(settings: EditorialistEffortSettings): EffortParams {
	return {
		wordsPerNewScene: settings.wordsPerNewScene,
		draftRateWordsPerHour: settings.draftRateWordsPerHour,
		minutesPerDirective: settings.minutesPerDirective,
		dailyWritingHours: settings.dailyWritingHours,
		scopeWeight: DEFAULT_EFFORT_PARAMS.scopeWeight,
		tierWeight: DEFAULT_EFFORT_PARAMS.tierWeight,
	};
}

/** Compact "Xh Ym" / "Ym" label for a minute count. */
export function formatEffortDuration(minutes: number): string {
	if (minutes <= 0) {
		return "0m";
	}
	const hours = Math.floor(minutes / 60);
	const mins = Math.round(minutes % 60);
	if (hours === 0) {
		return `${mins}m`;
	}
	return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}
