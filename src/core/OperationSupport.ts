import {
	isCondenseSuggestion,
	isCutSuggestion,
	isEditSuggestion,
	isMoveSuggestion,
	type CondenseSuggestion,
	type CutSuggestion,
	type EditSuggestion,
	type MoveSuggestion,
	type ReviewSuggestion,
	type ReviewStatus,
	type ReviewTargetRef,
} from "../models/ReviewSuggestion";

export interface ReviewCopyBlock {
	body: string;
	label: string;
}

export interface ReviewApplyPlan {
	from: number;
	focusEnd?: number;
	focusStart?: number;
	text: string;
	to: number;
}

export type ReviewSuggestionPresentationTone = "active" | "muted";

interface OperationSupport<T extends ReviewSuggestion> {
	canApply: (suggestion: T) => boolean;
	createApplyPlan: (noteText: string, suggestion: T) => ReviewApplyPlan | null;
	getCopyBlocks: (suggestion: T) => ReviewCopyBlock[];
	getPrimaryTarget: (suggestion: T) => ReviewTargetRef | undefined;
	getReason: (suggestion: T) => string;
	getSignatureParts: (suggestion: T) => string[];
}

const operationSupport: {
	[K in ReviewSuggestion["operation"]]: OperationSupport<Extract<ReviewSuggestion, { operation: K }>>;
} = {
	edit: {
		canApply: (suggestion: EditSuggestion) =>
			suggestion.executionMode === "direct" &&
			Boolean(
				suggestion.location.primary &&
					suggestion.location.primary.matchType === "exact" &&
					suggestion.location.primary.startOffset !== undefined &&
					suggestion.location.primary.endOffset !== undefined &&
					suggestion.payload.revised,
			),
		createApplyPlan: (noteText: string, suggestion: EditSuggestion) => {
			const match = suggestion.location.primary;
			if (
				!match ||
				match.startOffset === undefined ||
				match.endOffset === undefined ||
				match.matchType !== "exact"
			) {
				return null;
			}

			const existingText = noteText.slice(match.startOffset, match.endOffset);
			if (existingText !== suggestion.payload.original) {
				return null;
			}

			return {
				from: match.startOffset,
				to: match.endOffset,
				text: suggestion.payload.revised,
			};
		},
		getCopyBlocks: (suggestion: EditSuggestion) => [
			{ label: "Original", body: suggestion.payload.original },
			{ label: "Revised", body: suggestion.payload.revised },
		],
		getPrimaryTarget: (suggestion: EditSuggestion) => suggestion.location.primary,
		getReason: (suggestion: EditSuggestion) => suggestion.location.primary?.reason ?? "Awaiting edit resolution.",
		getSignatureParts: (suggestion: EditSuggestion) => [
			suggestion.payload.original,
			suggestion.payload.revised,
		],
	},
	move: {
		canApply: (suggestion: MoveSuggestion) =>
			suggestion.executionMode === "direct" && Boolean(suggestion.location.relocation?.canApply),
		createApplyPlan: (noteText: string, suggestion: MoveSuggestion) => {
			const relocation = suggestion.location.relocation;
			if (!relocation?.canApply) {
				return null;
			}

			const { targetStart, targetEnd, anchorStart, anchorEnd } = relocation;
			if (
				targetStart === undefined ||
				targetEnd === undefined ||
				anchorStart === undefined ||
				anchorEnd === undefined
			) {
				return null;
			}

			const targetText = noteText.slice(targetStart, targetEnd);
			if (targetText !== suggestion.payload.target) {
				return null;
			}

			const removedLength = targetEnd - targetStart;
			const withoutTarget = noteText.slice(0, targetStart) + noteText.slice(targetEnd);
			let adjustedAnchorStart = anchorStart;
			let adjustedAnchorEnd = anchorEnd;

			if (targetStart < anchorStart) {
				adjustedAnchorStart -= removedLength;
				adjustedAnchorEnd -= removedLength;
			}

			const insertOffset =
				suggestion.payload.placement === "before" ? adjustedAnchorStart : adjustedAnchorEnd;
			const normalizedTargetText = targetText.replace(/^\n+|\n+$/g, "");
			const beforeContext = withoutTarget.slice(0, insertOffset);
			const afterContext = withoutTarget.slice(insertOffset);
			const prefix =
				beforeContext.length === 0
					? ""
					: beforeContext.endsWith("\n\n")
						? ""
						: beforeContext.endsWith("\n")
							? "\n"
							: "\n\n";
			const suffix =
				afterContext.length === 0
					? ""
					: afterContext.startsWith("\n\n")
						? ""
						: afterContext.startsWith("\n")
							? "\n"
							: "\n\n";
			const insertedText = `${prefix}${normalizedTargetText}${suffix}`;
			const focusStart = insertOffset + prefix.length;
			const focusEnd = focusStart + normalizedTargetText.length;

			return {
				from: 0,
				to: noteText.length,
				text: withoutTarget.slice(0, insertOffset) + insertedText + withoutTarget.slice(insertOffset),
				focusStart,
				focusEnd,
			};
		},
		getCopyBlocks: (suggestion: MoveSuggestion) => [
			{ label: "Target", body: suggestion.payload.target },
			{
				label: suggestion.payload.placement === "after" ? "After anchor" : "Before anchor",
				body: suggestion.payload.anchor,
			},
		],
		getPrimaryTarget: (suggestion: MoveSuggestion) =>
			suggestion.location.target ?? suggestion.location.anchor,
		getReason: (suggestion: MoveSuggestion) =>
			suggestion.location.relocation?.reason ??
			suggestion.location.target?.reason ??
			suggestion.location.anchor?.reason ??
			"Awaiting move resolution.",
		getSignatureParts: (suggestion: MoveSuggestion) => [
			suggestion.payload.target,
			suggestion.payload.anchor,
			suggestion.payload.placement,
		],
	},
	cut: {
		canApply: (suggestion: CutSuggestion) =>
			suggestion.executionMode === "direct" &&
			Boolean(
				suggestion.location.target &&
					suggestion.location.target.matchType === "exact" &&
					suggestion.location.target.startOffset !== undefined &&
					suggestion.location.target.endOffset !== undefined,
			),
		createApplyPlan: (noteText: string, suggestion: CutSuggestion) => {
			const target = suggestion.location.target;
			if (
				!target ||
				target.startOffset === undefined ||
				target.endOffset === undefined ||
				target.matchType !== "exact"
			) {
				return null;
			}

			const existingText = noteText.slice(target.startOffset, target.endOffset);
			if (existingText !== suggestion.payload.target) {
				return null;
			}

			return {
				from: target.startOffset,
				to: target.endOffset,
				text: "",
			};
		},
		getCopyBlocks: (suggestion: CutSuggestion) => [{ label: "Target", body: suggestion.payload.target }],
		getPrimaryTarget: (suggestion: CutSuggestion) => suggestion.location.target,
		getReason: (suggestion: CutSuggestion) => suggestion.location.target?.reason ?? "Awaiting cut resolution.",
		getSignatureParts: (suggestion: CutSuggestion) => [suggestion.payload.target],
	},
	condense: {
		canApply: (suggestion: CondenseSuggestion) =>
			suggestion.executionMode === "direct" &&
			Boolean(
				suggestion.payload.suggestion &&
					suggestion.location.target &&
					suggestion.location.target.matchType === "exact" &&
					suggestion.location.target.startOffset !== undefined &&
					suggestion.location.target.endOffset !== undefined,
			),
		createApplyPlan: (noteText: string, suggestion: CondenseSuggestion) => {
			if (!suggestion.payload.suggestion) {
				return null;
			}

			const target = suggestion.location.target;
			if (
				!target ||
				target.startOffset === undefined ||
				target.endOffset === undefined ||
				target.matchType !== "exact"
			) {
				return null;
			}

			const existingText = noteText.slice(target.startOffset, target.endOffset);
			if (existingText !== suggestion.payload.target) {
				return null;
			}

			return {
				from: target.startOffset,
				to: target.endOffset,
				text: suggestion.payload.suggestion,
			};
		},
		getCopyBlocks: (suggestion: CondenseSuggestion) => [
			{ label: "Target", body: suggestion.payload.target },
			...(suggestion.payload.suggestion
				? [{ label: "Suggestion", body: suggestion.payload.suggestion }]
				: []),
		],
		getPrimaryTarget: (suggestion: CondenseSuggestion) => suggestion.location.target,
		getReason: (suggestion: CondenseSuggestion) => {
			if (suggestion.executionMode === "advisory") {
				return suggestion.location.target?.reason
					? `${suggestion.location.target.reason} Advisory condense guidance is not directly applicable yet.`
					: "Advisory condense guidance is not directly applicable yet.";
			}

			return suggestion.location.target?.reason ?? "Awaiting condense resolution.";
		},
		getSignatureParts: (suggestion: CondenseSuggestion) => [
			suggestion.payload.target,
			suggestion.payload.suggestion ?? "",
		],
	},
};

export function getSuggestionPrimaryTarget(suggestion: ReviewSuggestion): ReviewTargetRef | undefined {
	return operationSupport[suggestion.operation].getPrimaryTarget(suggestion as never);
}

export function getSuggestionAnchorTarget(suggestion: ReviewSuggestion): ReviewTargetRef | undefined {
	return isMoveSuggestion(suggestion) ? suggestion.location.anchor : undefined;
}

export function getSuggestionReason(suggestion: ReviewSuggestion): string {
	if (suggestion.status === "accepted") {
		const targets = [suggestion.location.primary, suggestion.location.target, suggestion.location.anchor];
		if (targets.some((target) => target?.matchType === "already_applied")) {
			return "Already reflected in the manuscript.";
		}

		return "Accepted into the manuscript.";
	}

	if (suggestion.status === "rejected") {
		return "Rejected for this review session.";
	}

	if (suggestion.status === "rewritten") {
		return "Rewritten by the author.";
	}

	if (suggestion.status === "deferred") {
		return "Deferred in this review pass.";
	}

	return operationSupport[suggestion.operation].getReason(suggestion as never);
}

export function getSuggestionCopyBlocks(suggestion: ReviewSuggestion): ReviewCopyBlock[] {
	return operationSupport[suggestion.operation].getCopyBlocks(suggestion as never);
}

export function isSuggestionResolved(suggestion: ReviewSuggestion): boolean {
	if (suggestion.status === "accepted" || suggestion.status === "rewritten") {
		return true;
	}

	return [
		suggestion.location.primary,
		suggestion.location.target,
		suggestion.location.anchor,
	].some((target) => target?.matchType === "already_applied");
}

export function getSuggestionPresentationTone(suggestion: ReviewSuggestion): ReviewSuggestionPresentationTone {
	return suggestion.status === "accepted" || suggestion.status === "rejected" || suggestion.status === "rewritten" ? "muted" : "active";
}

export function getSuggestionStatusRank(_status: ReviewStatus): number {
	return 0;
}

export function canApplySuggestionDirectly(suggestion: ReviewSuggestion): boolean {
	return operationSupport[suggestion.operation].canApply(suggestion as never);
}

export function createSuggestionApplyPlan(noteText: string, suggestion: ReviewSuggestion): ReviewApplyPlan | null {
	return operationSupport[suggestion.operation].createApplyPlan(noteText, suggestion as never);
}

export function getSuggestionSignatureParts(suggestion: ReviewSuggestion): string[] {
	return operationSupport[suggestion.operation].getSignatureParts(suggestion as never);
}

export { isCondenseSuggestion, isCutSuggestion, isEditSuggestion, isMoveSuggestion };
