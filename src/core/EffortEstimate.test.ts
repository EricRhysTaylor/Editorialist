import { describe, expect, it } from "vitest";
import type {
	Editorialism,
	EditorialismItem,
	EditorialismItemStatus,
} from "../models/Editorialism";
import {
	DEFAULT_EFFORT_PARAMS,
	estimateEditorialismEffort,
	formatEffortDuration,
} from "./EffortEstimate";

function item(over: Partial<EditorialismItem> = {}): EditorialismItem {
	return {
		lineIndex: 0,
		status: "open" as EditorialismItemStatus,
		text: "",
		scope: null,
		tags: [],
		...over,
	};
}

function doc(items: EditorialismItem[]): Editorialism {
	return {
		filePath: "x.md",
		title: "X",
		book: null,
		status: null,
		created: null,
		sections: [{ heading: "S", items }],
	};
}

describe("estimateEditorialismEffort", () => {
	it("costs explicit [words::] as drafting time at the configured rate", () => {
		// 1500 words / 750 wph = 2h = 120m.
		const est = estimateEditorialismEffort(doc([item({ effort: { words: 1500 } })]));
		expect(est.newWords).toBe(1500);
		expect(est.draftingMinutes).toBe(120);
		expect(est.directiveItems).toBe(0);
		expect(est.totalMinutes).toBe(120);
	});

	it("expands [scenes::] into words via wordsPerNewScene", () => {
		const est = estimateEditorialismEffort(doc([item({ effort: { scenes: 2 } })]));
		expect(est.newScenes).toBe(2);
		expect(est.newWords).toBe(2 * DEFAULT_EFFORT_PARAMS.wordsPerNewScene);
	});

	it("detects new scenes from prose when unannotated", () => {
		const est = estimateEditorialismEffort(
			doc([item({ text: "Add two new present-tense scenes for Cesena" })]),
		);
		expect(est.newScenes).toBe(2);
	});

	it("weights directive minutes by scope (manuscript heavier than scene)", () => {
		const scene = estimateEditorialismEffort(
			doc([item({ text: "tighten the cenote beat", scope: { kind: "scene", scene: "38", raw: "38" } })]),
		);
		const manuscript = estimateEditorialismEffort(
			doc([item({ text: "standardize stage labels", scope: { kind: "manuscript", raw: "manuscript" } })]),
		);
		expect(manuscript.directiveMinutes).toBeGreaterThan(scene.directiveMinutes);
		expect(scene.directiveMinutes).toBe(DEFAULT_EFFORT_PARAMS.minutesPerDirective);
	});

	it("multiplies range directives by the scene span", () => {
		const est = estimateEditorialismEffort(
			doc([item({ text: "reconcile timeline", scope: { kind: "range", start: "13", end: "22", raw: "13–22" } })]),
		);
		expect(est.directiveMinutes).toBe(DEFAULT_EFFORT_PARAMS.minutesPerDirective * 10);
	});

	it("scales by [effort:: tier]", () => {
		const heavy = estimateEditorialismEffort(
			doc([item({ text: "rework subplot", scope: { kind: "scene", scene: "5", raw: "5" }, effort: { tier: "heavy" } })]),
		);
		expect(heavy.directiveMinutes).toBe(DEFAULT_EFFORT_PARAMS.minutesPerDirective * DEFAULT_EFFORT_PARAMS.tierWeight.heavy);
	});

	it("ignores done and deferred items", () => {
		const est = estimateEditorialismEffort(
			doc([
				item({ status: "done", effort: { words: 5000 } }),
				item({ status: "deferred", effort: { words: 5000 } }),
				item({ status: "open", text: "small scene-level note", scope: { kind: "scene", scene: "1", raw: "1" } }),
			]),
		);
		expect(est.actionableItems).toBe(1);
		expect(est.newWords).toBe(0);
	});

	it("derives whole sessions from the daily writing budget", () => {
		// 3 scenes * 1500 = 4500 words / 750 = 6h. At 2h/day → 3 sessions.
		const est = estimateEditorialismEffort(doc([item({ effort: { scenes: 3 } })]));
		expect(est.totalMinutes).toBe(360);
		expect(est.sessions).toBe(3);
	});
});

describe("formatEffortDuration", () => {
	it("formats hours and minutes", () => {
		expect(formatEffortDuration(0)).toBe("0m");
		expect(formatEffortDuration(45)).toBe("45m");
		expect(formatEffortDuration(120)).toBe("2h");
		expect(formatEffortDuration(150)).toBe("2h 30m");
	});
});
