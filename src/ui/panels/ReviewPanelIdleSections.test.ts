import { describe, it, expect } from "vitest";
import {
	formatRecentReviewSceneTitle,
	formatRelativeTime,
	formatStatsTooltip,
	isBatchReadyToClean,
} from "./ReviewPanelIdleSections";

describe("formatRelativeTime", () => {
	const NOW = 1_700_000_000_000;

	it("returns 'just now' for sub-minute differences", () => {
		expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
		expect(formatRelativeTime(NOW, NOW)).toBe("just now");
	});

	it("expresses minutes / hours / days / weeks / months / years", () => {
		expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
		expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
		expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
		expect(formatRelativeTime(NOW - 14 * 86_400_000, NOW)).toBe("2w ago");
		// 35 days -> months path
		expect(formatRelativeTime(NOW - 35 * 86_400_000, NOW)).toBe("1mo ago");
		expect(formatRelativeTime(NOW - 400 * 86_400_000, NOW)).toBe("1y ago");
	});

	it("hour and day boundaries align with the original implementation", () => {
		// 60 minutes -> 1h, not 60m
		expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe("1h ago");
		// 24 hours -> 1d, not 24h
		expect(formatRelativeTime(NOW - 24 * 3_600_000, NOW)).toBe("1d ago");
	});
});

describe("formatStatsTooltip", () => {
	it("always lists accepted / rejected / rewritten", () => {
		expect(formatStatsTooltip({ accepted: 3, rejected: 1, rewritten: 2, deferred: 0 })).toBe(
			"3 accepted · 1 rejected · 2 rewritten",
		);
	});

	it("appends deferred only when it is greater than zero", () => {
		expect(formatStatsTooltip({ accepted: 0, rejected: 0, rewritten: 0, deferred: 4 })).toBe(
			"0 accepted · 0 rejected · 0 rewritten · 4 deferred",
		);
		expect(formatStatsTooltip({ accepted: 1, rejected: 0, rewritten: 0, deferred: 0 })).toBe(
			"1 accepted · 0 rejected · 0 rewritten",
		);
	});
});

describe("formatRecentReviewSceneTitle", () => {
	const base = { sceneOrder: [] as string[], importedNotePaths: [] as string[] };

	it("falls back to the active-book label when no paths exist", () => {
		expect(formatRecentReviewSceneTitle({ ...base, activeBookLabel: "Book One" })).toBe(
			"Book One",
		);
	});

	it("falls back to 'Review pass' when nothing resolvable is available", () => {
		expect(formatRecentReviewSceneTitle({ ...base })).toBe("Review pass");
		expect(
			formatRecentReviewSceneTitle({ ...base, activeBookLabel: "   " }),
		).toBe("Review pass");
	});

	it("strips paths and .md to a basename for a single scene", () => {
		expect(
			formatRecentReviewSceneTitle({
				...base,
				sceneOrder: ["Books/One/Scene 3.md"],
			}),
		).toBe("Scene 3");
	});

	it("comma-joins 2 or 3 scene names", () => {
		expect(
			formatRecentReviewSceneTitle({
				...base,
				sceneOrder: ["A.md", "B.md"],
			}),
		).toBe("A, B");
		expect(
			formatRecentReviewSceneTitle({
				...base,
				sceneOrder: ["A.md", "B.md", "C.md"],
			}),
		).toBe("A, B, C");
	});

	it("names up to four scenes, then adds a count suffix", () => {
		expect(
			formatRecentReviewSceneTitle({
				...base,
				sceneOrder: ["A.md", "B.md", "C.md", "D.md", "E.md"],
			}),
		).toBe("A, B, C, D, +1 more");
	});

	it("orders multi-scene titles ascending by leading scene number", () => {
		expect(
			formatRecentReviewSceneTitle({
				...base,
				sceneOrder: ["51 Long Road Up.md", "13 Shail Begins Race.md", "52 Crest.md"],
			}),
		).toBe("13 Shail Begins…, 51 Long Road…, 52 Crest");
	});

	it("shortens each scene to its number plus two words", () => {
		expect(
			formatRecentReviewSceneTitle({
				...base,
				sceneOrder: ["38 Stage 4 Underwater.md", "36 Stage 2 Part 2.md"],
			}),
		).toBe("36 Stage 2…, 38 Stage 4…");
	});

	it("uses importedNotePaths only when sceneOrder is empty", () => {
		expect(
			formatRecentReviewSceneTitle({
				sceneOrder: [],
				importedNotePaths: ["Books/One/Backup.md"],
			}),
		).toBe("Backup");
	});

	it("prefers sceneOrder over importedNotePaths when both are populated", () => {
		expect(
			formatRecentReviewSceneTitle({
				sceneOrder: ["From Order.md"],
				importedNotePaths: ["From Imported.md"],
			}),
		).toBe("From Order");
	});

	it("names only in-scope scenes when a scope folder is given", () => {
		expect(
			formatRecentReviewSceneTitle(
				{
					...base,
					sceneOrder: ["Books/One/37 Volcano.md", "Logs/Inquiry Content Log.md"],
				},
				"Books/One",
			),
		).toBe("37 Volcano");
	});

	it("names every path when no scope folder is given (back-compat)", () => {
		expect(
			formatRecentReviewSceneTitle({
				...base,
				sceneOrder: ["Books/One/37 Volcano.md", "Logs/Inquiry Content Log.md"],
			}),
		).toBe("37 Volcano, Inquiry Content…");
	});

	it("falls back to unfiltered paths when the scope filter would empty the list", () => {
		// A batch entirely outside the active book still shows its scenes rather
		// than rendering blank.
		expect(
			formatRecentReviewSceneTitle(
				{
					...base,
					sceneOrder: ["Books/Two/Chapter 1.md"],
				},
				"Books/One",
			),
		).toBe("Chapter 1");
	});
});

describe("isBatchReadyToClean", () => {
	const stats = (over: Partial<{ accepted: number; rejected: number; rewritten: number; deferred: number }> = {}) => ({
		accepted: 0,
		rejected: 0,
		rewritten: 0,
		deferred: 0,
		...over,
	});

	it("is ready when every suggestion is decided and none deferred", () => {
		// The reported case: 8 suggestions, 7 accepted + 1 rejected.
		expect(
			isBatchReadyToClean({ status: "in_progress", totalSuggestions: 8 }, stats({ accepted: 7, rejected: 1 })),
		).toBe(true);
	});

	it("is ready even while entry.status is still in_progress (other batch on the scene)", () => {
		// entry.status is scene-aggregated, so it can lag; the decision math wins.
		expect(
			isBatchReadyToClean({ status: "in_progress", totalSuggestions: 2 }, stats({ accepted: 1, rewritten: 1 })),
		).toBe(true);
	});

	it("is not ready when some suggestions are still undecided", () => {
		// 37 suggestions, only 8 decided.
		expect(
			isBatchReadyToClean({ status: "in_progress", totalSuggestions: 37 }, stats({ accepted: 7, rejected: 1 })),
		).toBe(false);
	});

	it("is not ready when any suggestion is deferred", () => {
		expect(
			isBatchReadyToClean({ status: "in_progress", totalSuggestions: 3 }, stats({ accepted: 2, deferred: 1 })),
		).toBe(false);
	});

	it("is not ready for an already-cleaned batch", () => {
		expect(
			isBatchReadyToClean({ status: "cleaned", totalSuggestions: 8 }, stats({ accepted: 7, rejected: 1 })),
		).toBe(false);
	});

	it("is not ready for a batch with no suggestions", () => {
		expect(isBatchReadyToClean({ status: "completed", totalSuggestions: 0 }, stats())).toBe(false);
	});
});
