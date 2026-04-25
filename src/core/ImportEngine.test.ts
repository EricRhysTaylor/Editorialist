import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { ImportEngine } from "./ImportEngine";
import { MatchEngine } from "./MatchEngine";
import { SuggestionParser } from "./SuggestionParser";
import { ReviewerDirectory } from "../state/ReviewerDirectory";
import { createMockApp, type MockApp } from "../../tests/mocks/vault";

function createImportEngine(app: MockApp): ImportEngine {
	const reviewers = new ReviewerDirectory();
	const parser = new SuggestionParser(reviewers);
	const matcher = new MatchEngine();
	// MockApp is a structural superset of the slice ImportEngine actually touches.
	return new ImportEngine(app as unknown as App, parser, matcher);
}

const SCENE_PATH = "Book/Scenes/Shail Begins Race.md";

const SCENE_BODY = [
	"She loses her exultant feeling quickly, replaced by a sense of disquiet.",
	"",
	"He seemed to be recovering when she checked on him at the medi.",
	"",
	"A swarm of dust motes converges above, the nearly microscopic cameras that will capture all the drama from every angle during the Tourney.",
].join("\n");

const PASTE = `Template: Editorialist advanced
TemplateYear: 2026
SupportedOperations: Edit, Move, Cut, Condense
Reviewer: GPT-5.4
ReviewerType: ai-editor
Provider: OpenAI
Model: GPT-5.4

=== EDIT ===
SceneId: scn_shail_begins_race_01
Original: She loses her exultant feeling quickly, replaced by a sense of disquiet.
Revised: She loses her exultant feeling instantly, replaced by disquiet.
Why: Tighten cadence.

=== CONDENSE ===
SceneId: scn_shail_begins_race_23
Target: Flight strategy paragraph (storm hopping, jet stream, altitude)
Suggestion: Reduce to 2–3 sharp lines focused on intent and risk.
Why: Maintain pacing during high-tension launch.

=== CUT ===
SceneId: scn_shail_begins_race_22
Target: Extended explanation of Tourney philosophy speech mid-action
Why: Info-dump during a critical moment.
`;

describe("ImportEngine — fallback to active note for descriptive targets", () => {
	it("routes EDIT (exact match) and CONDENSE/CUT (descriptive target) to the same scene file", async () => {
		const app = createMockApp([
			{
				path: SCENE_PATH,
				body: SCENE_BODY,
				frontmatter: { Class: "Scene" },
			},
		]);
		const engine = createImportEngine(app);

		const batch = await engine.inspectBatch(PASTE, { activeNotePath: SCENE_PATH });

		// All three suggestions must resolve to the active scene.
		expect(batch.results).toHaveLength(3);
		for (const result of batch.results) {
			expect(result.routeStatus).toBe("resolved");
			expect(result.resolvedPath).toBe(SCENE_PATH);
		}

		// EDIT anchors via inferred_exact (Original is verbatim scene text).
		const editResult = batch.results.find((result) => result.suggestion.operation === "edit");
		expect(editResult?.routeStrategy).toBe("inferred_exact");
		expect(editResult?.verificationStatus).toBe("exact");

		// CONDENSE + CUT use descriptive targets — no anchoring text in the scene.
		// They should fall back to the active note rather than getting dropped.
		const condense = batch.results.find((result) => result.suggestion.operation === "condense");
		const cut = batch.results.find((result) => result.suggestion.operation === "cut");
		expect(condense?.routeStrategy).toBe("fallback_active_note");
		expect(condense?.verificationStatus).toBe("none");
		expect(cut?.routeStrategy).toBe("fallback_active_note");
		expect(cut?.verificationStatus).toBe("none");
	});

	it("writes ALL three suggestions into a single ready group in the embed block", async () => {
		const app = createMockApp([
			{
				path: SCENE_PATH,
				body: SCENE_BODY,
				frontmatter: { Class: "Scene" },
			},
		]);
		const engine = createImportEngine(app);

		const batch = await engine.inspectBatch(PASTE, { activeNotePath: SCENE_PATH });
		expect(batch.groups).toHaveLength(1);
		expect(batch.groups[0].isReady).toBe(true);
		expect(batch.groups[0].suggestions).toHaveLength(3);

		await engine.importBatch(batch);

		const writtenBody = app.peek(SCENE_PATH);
		expect(writtenBody).toContain("```editorialist-review");
		expect(writtenBody).toContain("=== EDIT ===");
		expect(writtenBody).toContain("=== CONDENSE ===");
		expect(writtenBody).toContain("=== CUT ===");
		expect(writtenBody).toContain("Flight strategy paragraph (storm hopping, jet stream, altitude)");
		expect(writtenBody).toContain("Extended explanation of Tourney philosophy speech mid-action");
	});

	it("does NOT fall back when there is no active note path", async () => {
		const app = createMockApp([
			{
				path: SCENE_PATH,
				body: SCENE_BODY,
				frontmatter: { Class: "Scene" },
			},
		]);
		const engine = createImportEngine(app);

		const batch = await engine.inspectBatch(PASTE);
		// EDIT still resolves via inferred_exact; CONDENSE/CUT fail without active note.
		const condense = batch.results.find((result) => result.suggestion.operation === "condense");
		const cut = batch.results.find((result) => result.suggestion.operation === "cut");
		expect(condense?.routeStatus).toBe("unresolved");
		expect(cut?.routeStatus).toBe("unresolved");
	});

	it("does NOT fall back when the active note is outside the scene scope", async () => {
		const app = createMockApp([
			{
				path: SCENE_PATH,
				body: SCENE_BODY,
				frontmatter: { Class: "Scene" },
			},
			{
				path: "Inbox/random.md",
				body: "Just a random note",
				// no Class: Scene
			},
		]);
		const engine = createImportEngine(app);

		const batch = await engine.inspectBatch(PASTE, { activeNotePath: "Inbox/random.md" });
		const condense = batch.results.find((result) => result.suggestion.operation === "condense");
		expect(condense?.routeStatus).toBe("unresolved");
	});
});
