import { describe, expect, it, vi } from "vitest";
import { runEditorUndo, type UndoableView } from "./EditorUndo";

function makeView(values: string[]): { view: UndoableView; undo: ReturnType<typeof vi.fn> } {
	let index = 0;
	const undo = vi.fn(() => {
		if (index < values.length - 1) {
			index += 1;
		}
	});
	const view: UndoableView = {
		editor: {
			getValue: () => values[index],
			undo,
		},
	};
	return { view, undo };
}

describe("runEditorUndo", () => {
	it("calls the editor's native undo() — not a command id — and reports the document changed", () => {
		// getValue() returns "after edit" first; undo() reverts it to "before edit".
		const { view, undo } = makeView(["after edit", "before edit"]);
		expect(runEditorUndo(view)).toBe(true);
		expect(undo).toHaveBeenCalledTimes(1);
	});

	it("reports false when undo() leaves the document unchanged (nothing to undo)", () => {
		const { view, undo } = makeView(["unchanged"]);
		expect(runEditorUndo(view)).toBe(false);
		expect(undo).toHaveBeenCalledTimes(1);
	});

	it("returns false without touching an editor when there is no active view", () => {
		expect(runEditorUndo(null)).toBe(false);
	});
});
