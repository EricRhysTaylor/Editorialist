import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export interface ReviewDecorationSnapshot {
	highlight: { end: number; start: number } | null;
	highlightTone: "active" | "muted";
}

interface ReviewDecorationState {
	highlight: { end: number; start: number } | null;
	highlightTone: "active" | "muted";
}

const syncReviewDecorationsEffect = StateEffect.define<ReviewDecorationSnapshot>();

const reviewDecorationsField = StateField.define<ReviewDecorationState>({
	create() {
		return {
			highlight: null,
			highlightTone: "active",
		};
	},
	update(value, transaction) {
		let highlight = value.highlight;
		let highlightTone = value.highlightTone;

		if (highlight) {
			highlight = {
				start: transaction.changes.mapPos(highlight.start, 1),
				end: transaction.changes.mapPos(highlight.end, -1),
			};
		}

		for (const effect of transaction.effects) {
			if (effect.is(syncReviewDecorationsEffect)) {
				highlight = effect.value.highlight;
				highlightTone = effect.value.highlightTone;
			}
		}

		return {
			highlight,
			highlightTone,
		};
	},
	provide: (field) => EditorView.decorations.from(field, buildDecorations),
});

export function createReviewDecorationsExtension(): Extension {
	return [reviewDecorationsField];
}

export function syncReviewDecorations(editorView: EditorView, snapshot: ReviewDecorationSnapshot): void {
	editorView.dispatch({
		effects: syncReviewDecorationsEffect.of(snapshot),
	});
}

function buildDecorations(state: ReviewDecorationState): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();

	if (state.highlight && state.highlight.end > state.highlight.start) {
		builder.add(
			state.highlight.start,
			state.highlight.end,
			Decoration.mark({
				class:
					state.highlightTone === "muted"
						? "editorialist-match-highlight editorialist-match-highlight--muted"
						: "editorialist-match-highlight editorialist-match-highlight--active",
			}),
		);
	}

	return builder.finish();
}
