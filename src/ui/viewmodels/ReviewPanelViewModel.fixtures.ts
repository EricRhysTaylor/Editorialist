// Golden fixtures for the selectReviewPanelBranch parity gate.
//
// Each fixture is a `branch` label + the minimal `inputs` that should land
// in that branch under the documented if-ladder. ReviewPanelViewModel.test.ts
// asserts selectReviewPanelBranch(fixture.inputs) === fixture.branch for every
// entry, so any drift in the projection fails the build. Add a fixture
// whenever a new branch is added to selectReviewPanelBranch.

import type { ReviewPanelBranch, ReviewPanelStateInputs } from "./ReviewPanelViewModel";

export function makeInputs(
	overrides: Partial<ReviewPanelStateInputs> = {},
): ReviewPanelStateInputs {
	return {
		hasCompletedSweep: false,
		hasSession: false,
		hasPostCompletionIdle: false,
		hasReviewActivityHistory: false,
		suggestionsLength: 0,
		hasHandoff: false,
		hasFilteredSuggestions: false,
		...overrides,
	};
}

export interface ReviewPanelFixture {
	name: string;
	branch: ReviewPanelBranch;
	inputs: ReviewPanelStateInputs;
}

export const REVIEW_PANEL_FIXTURES: ReviewPanelFixture[] = [
	{
		name: "completed sweep card short-circuits everything else",
		branch: "completed_sweep",
		// Even with a session and suggestions, the completed-sweep card wins.
		inputs: makeInputs({
			hasCompletedSweep: true,
			hasSession: true,
			suggestionsLength: 3,
			hasHandoff: true,
			hasFilteredSuggestions: true,
		}),
	},
	{
		name: "compact onboarding card: brand-new vault, no prior activity",
		branch: "idle:post-completion",
		// Genuinely empty workspace: plugin reports post-completion idle
		// (because there are zero scene records) AND no activity history of
		// any kind. Only this combination shows the compact onboarding card.
		inputs: makeInputs({ hasPostCompletionIdle: true, hasReviewActivityHistory: false }),
	},
	{
		name: "post-completion + prior history routes to richer workspace view",
		branch: "idle:workspace",
		// Sweep completed (post-completion gate fires) but the user has
		// prior review activity to anchor a history view on. The richer
		// workspace composition wins — no compact card.
		inputs: makeInputs({ hasPostCompletionIdle: true, hasReviewActivityHistory: true }),
	},
	{
		name: "workspace idle: no session, no completed sweep, no post-completion idle",
		branch: "idle:workspace",
		// hasPostCompletionIdle false here because !session && !completed means
		// the panel composes the workspace card stack (continue review, recent
		// activity, contributors, workflows disclosure).
		inputs: makeInputs({}),
	},
	{
		name: "workspace idle: prior activity, no post-completion idle gate firing",
		branch: "idle:workspace",
		// Active session resolved off-panel; plugin no longer reports
		// post-completion idle, history is present.
		inputs: makeInputs({ hasReviewActivityHistory: true }),
	},
	{
		name: "session with no parsed suggestions",
		branch: "session:no-suggestions",
		inputs: makeInputs({ hasSession: true, suggestionsLength: 0 }),
	},
	{
		name: "session with suggestions and an active guided-sweep handoff",
		branch: "session:handoff",
		inputs: makeInputs({
			hasSession: true,
			suggestionsLength: 4,
			hasHandoff: true,
			// hasFilteredSuggestions value is irrelevant once handoff wins;
			// keep it true to prove handoff still takes precedence.
			hasFilteredSuggestions: true,
		}),
	},
	{
		name: "session with suggestions but reviewer filter selects none",
		branch: "session:filtered-empty",
		inputs: makeInputs({
			hasSession: true,
			suggestionsLength: 4,
			hasHandoff: false,
			hasFilteredSuggestions: false,
		}),
	},
	{
		name: "active session list — suggestions render",
		branch: "session:list",
		inputs: makeInputs({
			hasSession: true,
			suggestionsLength: 4,
			hasHandoff: false,
			hasFilteredSuggestions: true,
		}),
	},
];
