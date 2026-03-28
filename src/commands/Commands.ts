import type EditorialistPlugin from "../main";

export function registerCommands(plugin: EditorialistPlugin): void {
	plugin.addCommand({
		id: "editorialist",
		name: "Begin",
		callback: () => {
			void plugin.openEditorialistModal();
		},
	});

	plugin.addCommand({
		id: "import-editorial-review-batch",
		name: "Import editorial review batch",
		callback: () => {
			void plugin.openEditorialistModal();
		},
	});

	plugin.addCommand({
		id: "prepare-review-format",
		name: "Prepare review format",
		callback: () => {
			void plugin.openEditorialistModal();
		},
	});

	plugin.addCommand({
		id: "parse-review-block",
		name: "Parse review blocks",
		hotkeys: [withModShift("R")],
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
		name: "Next suggestion",
		hotkeys: [withModShift("]")],
		callback: () => {
			void plugin.selectNextSuggestion();
		},
	});

	plugin.addCommand({
		id: "previous-suggestion",
		name: "Previous suggestion",
		hotkeys: [withModShift("[")],
		callback: () => {
			void plugin.selectPreviousSuggestion();
		},
	});

	plugin.addCommand({
		id: "accept-suggestion",
		name: "Accept selected suggestion",
		hotkeys: [withModShift("Enter")],
		callback: () => {
			void plugin.acceptSelectedSuggestion();
		},
	});

	plugin.addCommand({
		id: "reject-suggestion",
		name: "Reject selected suggestion",
		hotkeys: [withModShift("Backspace")],
		callback: () => {
			void plugin.rejectSelectedSuggestion();
		},
	});

	plugin.addCommand({
		id: "jump-to-target",
		name: "Jump to target",
		hotkeys: [withModShift("M")],
		callback: () => {
			void plugin.jumpToSelectedSuggestionTarget();
		},
	});

	plugin.addCommand({
		id: "jump-to-anchor",
		name: "Jump to anchor",
		hotkeys: [withModShift("A")],
		callback: () => {
			void plugin.jumpToSelectedSuggestionAnchor();
		},
	});

	plugin.addCommand({
		id: "jump-to-source",
		name: "Jump to source entry",
		hotkeys: [withModShift("S")],
		callback: () => {
			void plugin.jumpToSelectedSuggestionSource();
		},
	});
}

function withModShift(key: string): { key: string; modifiers: ["Mod", "Shift"] } {
	return {
		modifiers: ["Mod", "Shift"],
		key,
	};
}
