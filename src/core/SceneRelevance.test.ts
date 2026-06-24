import { describe, expect, it } from "vitest";
import type { EditorialismItemScope } from "../models/Editorialism";
import {
	buildSceneTokens,
	sceneNumberFromName,
	scopeRelatesToScene,
	type SceneRelevanceContext,
} from "./SceneRelevance";

const ctx = (over: Partial<SceneRelevanceContext> = {}): SceneRelevanceContext => ({
	sceneNumber: 45,
	tokens: new Set(["cesena", "didio", "intercontinental", "tourney"]),
	...over,
});

describe("sceneNumberFromName", () => {
	it("reads the leading integer", () => {
		expect(sceneNumberFromName("45 Cesena Scene")).toBe(45);
		expect(sceneNumberFromName("38 Stage 4 Underwater")).toBe(38);
	});
	it("returns null when not number-prefixed", () => {
		expect(sceneNumberFromName("Intro")).toBeNull();
	});
});

describe("buildSceneTokens", () => {
	it("unwraps wikilinks and keeps words ≥ 3 chars", () => {
		const tokens = buildSceneTokens(["[[Cesena Didio Trax Fairchild]]", "Intercontinental Tourney", "Action: Cesena returns"]);
		expect(tokens.has("cesena")).toBe(true);
		expect(tokens.has("fairchild")).toBe(true);
		expect(tokens.has("tourney")).toBe(true);
		expect(tokens.has("returns")).toBe(true);
	});
});

describe("scopeRelatesToScene", () => {
	const scope = (s: Partial<EditorialismItemScope>): EditorialismItemScope =>
		({ kind: "unknown", raw: "", ...s } as EditorialismItemScope);

	it("matches an exact scene number", () => {
		expect(scopeRelatesToScene(scope({ kind: "scene", scene: "45" }), ctx())).toBe(true);
		expect(scopeRelatesToScene(scope({ kind: "scene", scene: "44" }), ctx())).toBe(false);
	});

	it("matches a range that contains the scene", () => {
		expect(scopeRelatesToScene(scope({ kind: "range", start: "38", end: "51" }), ctx())).toBe(true);
		expect(scopeRelatesToScene(scope({ kind: "range", start: "10", end: "20" }), ctx())).toBe(false);
	});

	it("matches an arc whose name overlaps the scene's character/subplot tokens", () => {
		expect(scopeRelatesToScene(scope({ kind: "arc", arcName: "Cesena thread" }), ctx())).toBe(true);
		expect(scopeRelatesToScene(scope({ kind: "arc", arcName: "Wala margin" }), ctx())).toBe(false);
	});

	it("never matches manuscript or unknown scopes", () => {
		expect(scopeRelatesToScene(scope({ kind: "manuscript" }), ctx())).toBe(false);
		expect(scopeRelatesToScene(scope({ kind: "unknown" }), ctx())).toBe(false);
		expect(scopeRelatesToScene(null, ctx())).toBe(false);
	});

	it("does not match scene/range when the scene number is unknown", () => {
		expect(scopeRelatesToScene(scope({ kind: "scene", scene: "45" }), ctx({ sceneNumber: null }))).toBe(false);
		expect(scopeRelatesToScene(scope({ kind: "range", start: "38", end: "51" }), ctx({ sceneNumber: null }))).toBe(false);
	});
});
