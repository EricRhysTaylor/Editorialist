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
		id: "open-review-panel",
		name: "Open review panel",
		callback: () => {
			void plugin.openReviewPanel();
		},
	});

	plugin.addCommand({
		id: "review-pending-edits",
		name: "Review pending edits in active book",
		callback: () => {
			void plugin.startPendingEditsReview();
		},
	});
}
