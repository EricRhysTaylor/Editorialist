import { describe, expect, it } from "vitest";
import { buildConfiguredBookScope } from "./VaultScope";

describe("buildConfiguredBookScope", () => {
	it("returns an empty, unstructured scope for a blank override", () => {
		expect(buildConfiguredBookScope("")).toEqual({
			label: null,
			sourceFolder: null,
			structured: false,
		});
		expect(buildConfiguredBookScope("   ")).toEqual({
			label: null,
			sourceFolder: null,
			structured: false,
		});
	});

	it("derives a folder-only (unstructured) scope from a configured path", () => {
		const scope = buildConfiguredBookScope("Manuscripts/Book One");
		expect(scope.sourceFolder).toBe("Manuscripts/Book One");
		expect(scope.label).toBe("Book One");
		// Configured scope is never structured — non-RT notes have no Class: Scene.
		expect(scope.structured).toBe(false);
	});

	it("uses the whole path as the label for a top-level folder", () => {
		const scope = buildConfiguredBookScope("Draft");
		expect(scope.sourceFolder).toBe("Draft");
		expect(scope.label).toBe("Draft");
	});

	it("trims surrounding whitespace before normalizing", () => {
		expect(buildConfiguredBookScope("  Manuscripts/Book One  ").sourceFolder).toBe(
			"Manuscripts/Book One",
		);
	});
});
