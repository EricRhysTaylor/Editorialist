import { describe, expect, it } from "vitest";
import {
	computeFieldAfterDrain,
	extractInquiryBriefLinkTarget,
	formatPendingEditForDisplay,
	isInquiryLine,
	parsePendingEditsField,
	hasPendingEdits,
	buildSceneItems,
} from "./PendingEditsSegments";
import { extractFirstParagraph } from "./InquiryBriefContext";

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

describe("formatPendingEditForDisplay", () => {
	const path = "Book/Scene-01.md";
	const title = "Scene 01";
	const order = 1;

	it("returns human segment text as-is with no prefix", () => {
		const [segment] = parsePendingEditsField(path, title, order, "Tighten the opening paragraph.");
		const display = formatPendingEditForDisplay(segment);
		expect(display.mutedPrefix).toBeUndefined();
		expect(display.actionText).toBe("Tighten the opening paragraph.");
	});

	it("splits an Inquiry line into muted wiki-link prefix + action text", () => {
		const field = "[[Inquiry Brief — Pay4: Premature Resolution Apr 15 2026 @ 3.36pm|Briefing]] — Revise Trisan's first conscious post-crisis contact with 'her'.";
		const segments = parsePendingEditsField(path, title, order, field);
		const inquirySegment = segments[0];
		const display = formatPendingEditForDisplay(inquirySegment);
		expect(display.mutedPrefix).toBe("[[Inquiry Brief — Pay4: Premature Resolution Apr 15 2026 @ 3.36pm|Briefing]] — ");
		expect(display.actionText).toBe("Revise Trisan's first conscious post-crisis contact with 'her'.");
	});

	it("falls back to full text when Inquiry line is malformed (no ]] separator)", () => {
		const field = "[[Inquiry Brief — malformed without closing";
		const segments = parsePendingEditsField(path, title, order, field);
		const segment = segments[0];
		const display = formatPendingEditForDisplay(segment);
		expect(display.mutedPrefix).toBeUndefined();
		expect(display.actionText).toBe(field);
	});

	it("falls back when action text is missing after separator", () => {
		const field = "[[Inquiry Brief — abc|Briefing]] — ";
		const segments = parsePendingEditsField(path, title, order, field);
		const segment = segments[0];
		const display = formatPendingEditForDisplay(segment);
		expect(display.mutedPrefix).toBeUndefined();
		expect(display.actionText).toBe(field);
	});
});

describe("extractInquiryBriefLinkTarget", () => {
	const path = "Book/Scene-01.md";
	const title = "Scene 01";
	const order = 1;

	it("returns the wiki-link target for an Inquiry line", () => {
		const field = "[[Inquiry Brief — Pay4: Premature Resolution Apr 15 2026 @ 3.36pm|Briefing]] — Revise the opening.";
		const [segment] = parsePendingEditsField(path, title, order, field);
		expect(extractInquiryBriefLinkTarget(segment)).toBe("Inquiry Brief — Pay4: Premature Resolution Apr 15 2026 @ 3.36pm");
	});

	it("returns null for a human segment", () => {
		const [segment] = parsePendingEditsField(path, title, order, "Tighten dialogue.");
		expect(extractInquiryBriefLinkTarget(segment)).toBeNull();
	});

	it("returns null for a malformed Inquiry line missing the wiki-link", () => {
		const segments = parsePendingEditsField(path, title, order, "[[Inquiry Brief — broken without close");
		expect(extractInquiryBriefLinkTarget(segments[0])).toBeNull();
	});
});

describe("extractFirstParagraph", () => {
	it("returns the first non-heading paragraph", () => {
		const note = [
			"# Inquiry Brief: Pay4",
			"",
			"This brief surfaces a structural risk in the post-crisis arc — Trisan's voice loses momentum.",
			"",
			"More detail follows here that should be ignored.",
		].join("\n");
		const result = extractFirstParagraph(note);
		expect(result).toContain("structural risk");
		expect(result).not.toContain("More detail");
	});

	it("strips frontmatter before reading the body", () => {
		const note = [
			"---",
			"reviewer: ai",
			"---",
			"",
			"The actual brief copy.",
		].join("\n");
		expect(extractFirstParagraph(note)).toBe("The actual brief copy.");
	});

	it("returns null when only headings or empty content present", () => {
		const note = "# H1\n\n## H2\n\n";
		expect(extractFirstParagraph(note)).toBeNull();
	});

	it("truncates very long paragraphs with an ellipsis", () => {
		const long = "X ".repeat(400).trim();
		const result = extractFirstParagraph(long);
		expect(result).toBeTruthy();
		expect(result?.endsWith("…")).toBe(true);
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
