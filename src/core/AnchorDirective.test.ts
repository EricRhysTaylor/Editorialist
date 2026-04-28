import { describe, expect, it } from "vitest";
import { isAnchorMarker, rewriteAnchorEdit } from "./AnchorDirective";

describe("isAnchorMarker", () => {
	it("matches a parens-wrapped marker", () => {
		expect(isAnchorMarker("(scene end on continued flight)")).toBe(true);
		expect(isAnchorMarker("  (Party—Ravix introduction)  ")).toBe(true);
	});

	it("rejects regular prose", () => {
		expect(isAnchorMarker("She has imagined this moment for years.")).toBe(false);
		expect(isAnchorMarker("(start) followed by more text")).toBe(false);
		expect(isAnchorMarker("text ending with (note)")).toBe(false);
	});
});

describe("rewriteAnchorEdit", () => {
	const noteText = [
		"She steps onto the launch pad.",
		"",
		"Cameras swarm above her.",
		"",
		"She breathes once and spreads her wings.",
	].join("\n");

	it("returns null when original is not an anchor marker", () => {
		const result = rewriteAnchorEdit(noteText, "She steps onto the launch pad.", "(append) tail");
		expect(result).toBeNull();
	});

	it("returns null when revised has no directive", () => {
		const result = rewriteAnchorEdit(noteText, "(scene end)", "She stabilizes, pushes on.");
		expect(result).toBeNull();
	});

	it("appends after the last paragraph for (append)", () => {
		const result = rewriteAnchorEdit(
			noteText,
			"(scene end on continued flight)",
			"(append) She stabilizes, pushes on.",
		);
		expect(result).not.toBeNull();
		expect(result?.original).toBe("She breathes once and spreads her wings.");
		expect(result?.revised).toBe(
			"She breathes once and spreads her wings.\n\nShe stabilizes, pushes on.",
		);
		expect(result?.reason).toContain("append");
	});

	it("prepends before the first paragraph for (prepend)", () => {
		const result = rewriteAnchorEdit(
			noteText,
			"(scene start)",
			"(prepend) The wind rises.",
		);
		expect(result).not.toBeNull();
		expect(result?.original).toBe("She steps onto the launch pad.");
		expect(result?.revised).toBe("The wind rises.\n\nShe steps onto the launch pad.");
	});

	it("inserts after the paragraph containing the keyword", () => {
		const result = rewriteAnchorEdit(
			noteText,
			"(camera moment)",
			'(insert after Cameras swarm) "Every angle, every metric."',
		);
		expect(result).not.toBeNull();
		expect(result?.original).toBe("Cameras swarm above her.");
		expect(result?.revised).toBe(
			'Cameras swarm above her.\n\n"Every angle, every metric."',
		);
		expect(result?.reason).toContain("insert after");
	});

	it("inserts before the paragraph containing the keyword", () => {
		const result = rewriteAnchorEdit(
			noteText,
			"(opening beat)",
			"(insert before Cameras swarm) She glances up.",
		);
		expect(result).not.toBeNull();
		expect(result?.original).toBe("Cameras swarm above her.");
		expect(result?.revised).toBe("She glances up.\n\nCameras swarm above her.");
	});

	it("falls back to token-based matching when full keyword is absent", () => {
		const result = rewriteAnchorEdit(
			noteText,
			"(camera moment)",
			"(insert after camera swarm above) tail",
		);
		expect(result).not.toBeNull();
		expect(result?.original).toBe("Cameras swarm above her.");
	});

	it("returns null when the keyword cannot be located", () => {
		const result = rewriteAnchorEdit(
			noteText,
			"(missing)",
			"(insert after nonexistent phrase here) tail",
		);
		expect(result).toBeNull();
	});

	it("returns null when paragraphs is empty", () => {
		const result = rewriteAnchorEdit("", "(end)", "(append) tail");
		expect(result).toBeNull();
	});
});
