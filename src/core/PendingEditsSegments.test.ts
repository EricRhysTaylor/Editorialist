import { describe, expect, it } from "vitest";
import {
	computeFieldAfterDrain,
	isInquiryLine,
	parsePendingEditsField,
	hasPendingEdits,
	buildSceneItems,
} from "./PendingEditsSegments";

describe("isInquiryLine", () => {
	it("detects the Inquiry Brief token", () => {
		expect(isInquiryLine("[[Inquiry Brief — 2026-01-15 abc|Briefing]] — Scene 1 — rework opening")).toBe(true);
	});

	it("returns false for human notes", () => {
		expect(isInquiryLine("Need to tighten the dialogue in this scene.")).toBe(false);
	});

	it("returns false for empty strings", () => {
		expect(isInquiryLine("")).toBe(false);
	});
});

describe("hasPendingEdits", () => {
	it("is true for non-empty strings", () => {
		expect(hasPendingEdits("something")).toBe(true);
	});

	it("is false for whitespace-only strings", () => {
		expect(hasPendingEdits("   \n  ")).toBe(false);
	});

	it("is false for non-string values", () => {
		expect(hasPendingEdits(undefined)).toBe(false);
		expect(hasPendingEdits(null)).toBe(false);
		expect(hasPendingEdits(42)).toBe(false);
		expect(hasPendingEdits({})).toBe(false);
	});
});

describe("parsePendingEditsField", () => {
	const path = "Book/Scene-01.md";
	const title = "Scene 01";
	const order = 1;

	it("returns no segments for an empty field", () => {
		expect(parsePendingEditsField(path, title, order, "")).toEqual([]);
		expect(parsePendingEditsField(path, title, order, "   \n  ")).toEqual([]);
	});

	it("produces a single human segment when only human notes exist", () => {
		const segments = parsePendingEditsField(
			path,
			title,
			order,
			"Tighten opening.\nCheck POV consistency.",
		);
		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({
			kind: "human",
			scenePath: path,
			sceneTitle: title,
			sceneOrder: order,
		});
		expect(segments[0].lines).toEqual([
			"Tighten opening.",
			"Check POV consistency.",
		]);
	});

	it("produces a separate segment for each Inquiry line", () => {
		const field = [
			"[[Inquiry Brief — 2026-01-15 abc|Briefing]] — rework opening",
			"[[Inquiry Brief — 2026-01-15 xyz|Briefing]] — cut filler",
		].join("\n");
		const segments = parsePendingEditsField(path, title, order, field);
		expect(segments).toHaveLength(2);
		expect(segments.every((s) => s.kind === "inquiry")).toBe(true);
		expect(segments[0].id).not.toEqual(segments[1].id);
	});

	it("orders human segment before Inquiry segments when both exist", () => {
		const field = [
			"Tighten dialogue.",
			"[[Inquiry Brief — 2026-01-15 abc|Briefing]] — rework opening",
			"More prose from human.",
			"[[Inquiry Brief — 2026-01-15 xyz|Briefing]] — cut filler",
		].join("\n");
		const segments = parsePendingEditsField(path, title, order, field);
		expect(segments.map((s) => s.kind)).toEqual(["human", "inquiry", "inquiry"]);
		expect(segments[0].lines).toEqual([
			"Tighten dialogue.",
			"More prose from human.",
		]);
	});

	it("ignores blank lines between entries", () => {
		const field = "Line one.\n\n\nLine two.";
		const segments = parsePendingEditsField(path, title, order, field);
		expect(segments).toHaveLength(1);
		expect(segments[0].lines).toEqual(["Line one.", "Line two."]);
	});
});

describe("computeFieldAfterDrain", () => {
	const path = "Book/Scene-01.md";
	const title = "Scene 01";
	const order = 1;

	it("removes the human block and preserves Inquiry lines", () => {
		const field = [
			"Tighten dialogue.",
			"More prose from human.",
			"[[Inquiry Brief — 2026-01-15 abc|Briefing]] — rework opening",
		].join("\n");
		const [humanSegment] = parsePendingEditsField(path, title, order, field);
		const result = computeFieldAfterDrain(field, humanSegment);
		expect(result.outcome).toBe("written");
		expect(result.nextValue).toBe("[[Inquiry Brief — 2026-01-15 abc|Briefing]] — rework opening");
	});

	it("removes a specific Inquiry line and preserves the rest", () => {
		const field = [
			"Tighten dialogue.",
			"[[Inquiry Brief — 2026-01-15 abc|Briefing]] — rework opening",
			"[[Inquiry Brief — 2026-01-15 xyz|Briefing]] — cut filler",
		].join("\n");
		const segments = parsePendingEditsField(path, title, order, field);
		const firstInquiry = segments.find((s) => s.kind === "inquiry" && s.text.includes("rework opening"));
		expect(firstInquiry).toBeDefined();
		const result = computeFieldAfterDrain(field, firstInquiry!);
		expect(result.outcome).toBe("written");
		expect(result.nextValue).toBe([
			"Tighten dialogue.",
			"[[Inquiry Brief — 2026-01-15 xyz|Briefing]] — cut filler",
		].join("\n"));
	});

	it("returns an empty value when the last segment is drained", () => {
		const field = "Only note.";
		const [human] = parsePendingEditsField(path, title, order, field);
		const result = computeFieldAfterDrain(field, human);
		expect(result.outcome).toBe("written");
		expect(result.nextValue).toBe("");
	});

	it("returns not_found when the target Inquiry line is missing", () => {
		const field = "Tighten dialogue.";
		const segments = parsePendingEditsField("other", title, order, "[[Inquiry Brief — stale|Briefing]] — gone");
		const staleInquiry = segments[0];
		const result = computeFieldAfterDrain(field, staleInquiry);
		expect(result.outcome).toBe("not_found");
		expect(result.nextValue).toBe(field);
	});
});

describe("buildSceneItems", () => {
	it("sorts by sceneOrder and drops scenes with no segments", () => {
		const items = buildSceneItems([
			{ path: "b", title: "B", order: 2, rawField: "Human note on B." },
			{ path: "a", title: "A", order: 1, rawField: "" },
			{ path: "c", title: "C", order: 3, rawField: "Human note on C." },
		]);
		expect(items.map((item) => item.scenePath)).toEqual(["b", "c"]);
	});
});
