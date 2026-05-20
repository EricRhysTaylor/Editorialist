import { describe, it, expect } from "vitest";
import {
	formatRecentReviewSceneTitle,
	formatRelativeTime,
	formatStatsTooltip,
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

	it("truncates 4+ scenes to the first two plus a count suffix", () => {
		expect(
			formatRecentReviewSceneTitle({
				...base,
				sceneOrder: ["A.md", "B.md", "C.md", "D.md", "E.md"],
			}),
		).toBe("A, B, +3 more");
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
});
