import type EditorialistPlugin from "../main";

export function registerCommands(plugin: EditorialistPlugin): void {
	plugin.addCommand({
		id: "open-review-launcher",
		name: "Open review launcher",
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
		id: "open-editorialism-panel",
		name: "Open editorialism panel",
		callback: () => {
			void plugin.openEditorialismPanel();
		},
	});

	plugin.addCommand({
		id: "review-pending-edits",
		name: "Review pending edits in active book",
		callback: () => {
			void plugin.startPendingEditsReview();
		},
	});

	plugin.addCommand({
		id: "rescan-review-blocks",
		name: "Rescan review blocks for cleanup",
		callback: () => {
			void plugin.rescanReviewBlocks();
		},
	});

	plugin.addCommand({
		id: "backup-selection-to-cut-file",
		name: "Backup selection to cut file",
		// editorCallback so the command only appears when an editor is active;
		// the plugin method re-reads the live selection itself.
		editorCallback: () => {
			void plugin.backupSelectionToCutFile();
		},
	});

	plugin.addCommand({
		id: "insert-author-query",
		name: "Insert author query",
		// editorCallback: only offered while editing a scene — exactly when an
		// author would annotate one. No default hotkey; the user can assign one.
		editorCallback: () => {
			void plugin.insertAuthorQuery();
		},
	});
}
