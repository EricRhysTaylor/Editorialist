import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type EditorialistPlugin from "../main";
import { ReviewToolbarWidget, type ToolbarState } from "./Toolbar";

export interface ReviewDecorationSnapshot {
	highlight: { end: number; start: number } | null;
	toolbar: ToolbarState | null;
}

interface ReviewDecorationState {
	highlight: { end: number; start: number } | null;
	toolbar: ToolbarState | null;
}

const syncReviewDecorationsEffect = StateEffect.define<ReviewDecorationSnapshot>();

const reviewDecorationsField = StateField.define<ReviewDecorationState>({
	create() {
		return {
			highlight: null,
			toolbar: null,
		};
	},
	update(value, transaction) {
		let highlight = value.highlight;
		let toolbar = value.toolbar;

		if (highlight) {
			highlight = {
				start: transaction.changes.mapPos(highlight.start, 1),
				end: transaction.changes.mapPos(highlight.end, -1),
			};
		}

		for (const effect of transaction.effects) {
			if (effect.is(syncReviewDecorationsEffect)) {
				highlight = effect.value.highlight;
				toolbar = effect.value.toolbar;
			}
		}

		return {
			highlight,
			toolbar,
		};
	},
	provide: (field) => EditorView.decorations.from(field, buildDecorations),
});

let activePlugin: EditorialistPlugin;

export function createReviewDecorationsExtension(plugin: EditorialistPlugin): Extension {
	activePlugin = plugin;
	return reviewDecorationsField;
}

export function syncReviewDecorations(editorView: EditorView, snapshot: ReviewDecorationSnapshot): void {
	editorView.dispatch({
		effects: syncReviewDecorationsEffect.of(snapshot),
	});
}

function buildDecorations(state: ReviewDecorationState): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();

	if (state.toolbar) {
		builder.add(
			0,
			0,
			Decoration.widget({
				widget: new ReviewToolbarWidget(activePlugin, state.toolbar),
				block: true,
				side: -1,
			}),
		);
	}

	if (state.highlight && state.highlight.end > state.highlight.start) {
		builder.add(
			state.highlight.start,
			state.highlight.end,
			Decoration.mark({
				class: "editorialist-match-highlight",
			}),
		);
	}

	return builder.finish();
}
