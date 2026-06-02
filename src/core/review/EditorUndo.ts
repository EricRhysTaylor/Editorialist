export interface UndoableEditor {
	getValue(): string;
	undo(): void;
}

// Redo, if/when a redo affordance is added, follows the exact same shape:
// call the Editor API's `editor.redo()` (NOT a command id — there is no
// "editor:redo" command, same as undo) and diff getValue() before/after to
// recover a boolean. Factor a `runEditorRedo` alongside `runEditorUndo` rather
// than reaching for app.commands.executeCommandById.

export interface UndoableView {
	editor: UndoableEditor;
}

/**
 * Drive the active editor's native undo() and report whether the document
 * actually changed.
 *
 * Obsidian does NOT register undo/redo as palette commands — they are native
 * CodeMirror keymap actions — so `app.commands.executeCommandById("editor:undo")`
 * returns `false` unconditionally and never performs an undo. Calling the
 * Editor API's `undo()` directly is the reliable path; we observe the document
 * value before/after to recover the boolean "did anything get undone" signal
 * that callers depend on.
 */
export function runEditorUndo(view: UndoableView | null): boolean {
	if (!view) {
		return false;
	}
	const before = view.editor.getValue();
	view.editor.undo();
	return view.editor.getValue() !== before;
}
