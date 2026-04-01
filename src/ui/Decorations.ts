import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export interface ReviewDecorationSnapshot {
	highlights: Array<{
		end: number;
		start: number;
		tone: "active" | "muted" | "applied" | "applied-active" | "anchor";
	}>;
}

interface ReviewDecorationState {
	highlights: Array<{
		end: number;
		start: number;
		tone: "active" | "muted" | "applied" | "applied-active" | "anchor";
	}>;
}

const syncReviewDecorationsEffect = StateEffect.define<ReviewDecorationSnapshot>();

const reviewDecorationsField = StateField.define<ReviewDecorationState>({
	create() {
		return {
			highlights: [],
		};
	},
	update(value, transaction) {
		let highlights = value.highlights.map((highlight) => ({
			...highlight,
			start: transaction.changes.mapPos(highlight.start, 1),
			end: transaction.changes.mapPos(highlight.end, -1),
		}));

		for (const effect of transaction.effects) {
			if (effect.is(syncReviewDecorationsEffect)) {
				highlights = effect.value.highlights;
			}
		}

		return {
			highlights,
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
	const highlights = [...state.highlights].sort((left, right) => {
		if (left.start !== right.start) {
			return left.start - right.start;
		}
		if (left.end !== right.end) {
			return left.end - right.end;
		}
		return left.tone.localeCompare(right.tone);
	});

	for (const highlight of highlights) {
		if (highlight.end <= highlight.start) {
			continue;
		}

		builder.add(
			highlight.start,
			highlight.end,
			Decoration.mark({
				class: `editorialist-match-highlight editorialist-match-highlight--${highlight.tone}`,
			}),
		);
	}

	return builder.finish();
}
