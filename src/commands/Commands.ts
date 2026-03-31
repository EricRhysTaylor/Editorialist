import type EditorialistPlugin from "../main";

export function registerCommands(plugin: EditorialistPlugin): void {
	plugin.addCommand({
		id: "editorialist",
		name: "Open review launcher",
		callback: () => {
			void plugin.openEditorialistModal();
		},
	});

	plugin.addCommand({
		id: "import-editorial-review-batch",
		name: "Import review batch",
		callback: () => {
			void plugin.openEditorialistModal();
		},
	});

	plugin.addCommand({
		id: "prepare-review-format",
		name: "Copy review format template",
		callback: () => {
			void plugin.openEditorialistModal();
		},
	});

	plugin.addCommand({
		id: "parse-review-block",
		name: "Parse review blocks in current note",
		callback: () => {
			void plugin.parseCurrentNote();
		},
	});

	plugin.addCommand({
		id: "open-review-panel",
		name: "Open review panel",
		callback: () => {
			void plugin.openReviewPanel();
		},
	});

	plugin.addCommand({
		id: "next-suggestion",
		name: "Select next suggestion",
		callback: () => {
			void plugin.selectNextSuggestion();
		},
	});

	plugin.addCommand({
		id: "previous-suggestion",
		name: "Select previous suggestion",
		callback: () => {
			void plugin.selectPreviousSuggestion();
		},
	});

	plugin.addCommand({
		id: "accept-suggestion",
		name: "Apply selected suggestion",
		callback: () => {
			void plugin.acceptSelectedSuggestion();
		},
	});

	plugin.addCommand({
		id: "accept-suggestion-and-advance",
		name: "Apply selected suggestion and select next",
		callback: () => {
			void plugin.acceptSelectedSuggestionAndAdvance();
		},
	});

	plugin.addCommand({
		id: "apply-and-review-scene-suggestions",
		name: "Apply and review scene suggestions",
		callback: () => {
			void plugin.enterApplyAndReviewConfirmMode();
		},
	});

	plugin.addCommand({
		id: "undo-applied-suggestion",
		name: "Undo applied suggestion",
		callback: () => {
			void plugin.undoLastAppliedSuggestion();
		},
	});

	plugin.addCommand({
		id: "reject-suggestion",
		name: "Reject selected suggestion",
		callback: () => {
			void plugin.rejectSelectedSuggestion();
		},
	});

	plugin.addCommand({
		id: "later-suggestion",
		name: "Defer selected suggestion",
		callback: () => {
			plugin.deferSelectedSuggestion();
		},
	});

	plugin.addCommand({
		id: "rewrite-suggestion",
		name: "Rewrite selected suggestion manually",
		callback: () => {
			void plugin.rewriteSelectedSuggestion();
		},
	});

	plugin.addCommand({
		id: "jump-to-target",
		name: "Jump to selected target",
		callback: () => {
			void plugin.jumpToSelectedSuggestionTarget();
		},
	});

	plugin.addCommand({
		id: "jump-to-anchor",
		name: "Jump to selected anchor",
		callback: () => {
			void plugin.jumpToSelectedSuggestionAnchor();
		},
	});

	plugin.addCommand({
		id: "jump-to-source",
		name: "Jump to selected source entry",
		callback: () => {
			void plugin.jumpToSelectedSuggestionSource();
		},
	});

	plugin.addCommand({
		id: "remove-imported-review-blocks-in-note",
		name: "Remove imported review blocks in this note",
		callback: () => {
			void plugin.removeImportedReviewBlocksInCurrentNote();
		},
	});

	plugin.addCommand({
		id: "clean-up-current-review-batch",
		name: "Clean up current review batch",
		callback: () => {
			void plugin.cleanupCurrentReviewBatch();
		},
	});
}
