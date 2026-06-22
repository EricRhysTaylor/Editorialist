import { describe, expect, it } from "vitest";
import { buildReviewTemplate } from "./ReviewTemplate";

// The injected contract + query listing live between the "AUTHOR QUERIES"
// banner and the trailing "Passage:" label. Scope assertions to that region so
// they don't collide with the base template, which legitimately contains its
// own "SceneId:" examples and the word "passage".
function queriesSection(out: string): string {
	const start = out.indexOf("AUTHOR QUERIES");
	const end = out.indexOf("\nPassage:");
	return out.slice(start, end === -1 ? undefined : end);
}

function passageSection(out: string): string {
	return out.slice(out.indexOf("\nPassage:"));
}

describe("buildReviewTemplate — author queries", () => {
	it("strips %%ai: …%% markers from the passage sent for review", () => {
		const passage = "She crossed the bridge. %%ai: Is this beat too abrupt?%% The lights went out.";
		const out = buildReviewTemplate(passage, { activeSceneId: "scn_abc123" });

		// The marker must not survive into the prose the model edits against.
		expect(out).not.toContain("%%ai:");
		const body = passageSection(out);
		expect(body).toContain("She crossed the bridge.");
		expect(body).toContain("The lights went out.");
		expect(body).not.toContain("Is this beat too abrupt?");
		expect(body).not.toContain("%%");
	});

	it("injects an AUTHOR QUERIES block with numbered ids and the active SceneId", () => {
		const passage = "%%ai: First question?%% Prose. %%ai: Second question?%%";
		const out = buildReviewTemplate(passage, { activeSceneId: "scn_abc123" });

		const section = queriesSection(out);
		expect(section).toContain("=== QUERY ===");
		expect(section).toContain("[Q1] SceneId: scn_abc123 — First question?");
		expect(section).toContain("[Q2] SceneId: scn_abc123 — Second question?");
	});

	it("omits SceneId from the query contract when no active scene is known", () => {
		const passage = "%%ai: Does this work?%% Prose here.";
		const out = buildReviewTemplate(passage);

		const section = queriesSection(out);
		expect(section).toContain("[Q1] Does this work?");
		expect(section).not.toContain("SceneId:");
	});

	it("collapses internal whitespace and newlines inside a query", () => {
		const passage = "Prose. %%ai:\n  Should the   motif\n  return here?\n%%";
		const out = buildReviewTemplate(passage, { activeSceneId: "scn_x" });
		expect(queriesSection(out)).toContain("[Q1] SceneId: scn_x — Should the motif return here?");
	});

	it("adds no AUTHOR QUERIES block when the passage has no markers", () => {
		const out = buildReviewTemplate("Just ordinary prose with no markers.", { activeSceneId: "scn_x" });
		expect(out).not.toContain("AUTHOR QUERIES");
		expect(out).toContain("Passage:");
	});

	it("ignores plain comments and editorialist-cut archive blocks", () => {
		const passage = "Prose. %% just a note to self %% More. %% editorialist-cut\nsource: x\n%%";
		const out = buildReviewTemplate(passage, { activeSceneId: "scn_x" });
		expect(out).not.toContain("AUTHOR QUERIES");
	});
});
