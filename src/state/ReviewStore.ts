import type { AuthorQueryStatus, ReviewSession, ReviewSuggestion, ReviewStatus } from "../models/ReviewSuggestion";

export interface GuidedSweepState {
	batchId: string;
	currentNoteIndex: number;
	notePaths: string[];
	startedAt: number;
}

export interface AppliedReviewChange {
	end: number;
	start: number;
	suggestionId: string;
}

export interface AppliedReviewState {
	currentIndex: number;
	entries: AppliedReviewChange[];
	notePath: string;
}

export interface CompletedSweepState {
	batchId: string;
	completedAt: number;
	currentNoteIndex: number;
	notePaths: string[];
	startedAt: number;
	totalSuggestions: number;
}

export interface ReviewStoreState {
	acknowledgedCompletedSweepBatchId: string | null;
	appliedReview: AppliedReviewState | null;
	completedSweep: CompletedSweepState | null;
	guidedSweep: GuidedSweepState | null;
	selectedSuggestionId: string | null;
	session: ReviewSession | null;
}

type Listener = (state: ReviewStoreState) => void;

// Keys that change on every session rebuild but never alter what a listener
// renders: `parsedAt` is a fresh parse timestamp, and `startOffset`/`endOffset`
// are target positions that shift as the author types around a review block.
// The panel draws suggestion text/status/reviewers, not positions, and editor
// highlights map their own positions through document changes (see
// Decorations.ts — the StateField calls mapPos on every transaction). Excluding
// these lets setSession refresh the stored session silently when only they
// changed, so typing in a reviewed scene no longer re-renders (and visibly
// flickers) the panel on every pause between keystrokes.
const VOLATILE_RENDER_SIGNATURE_KEYS = new Set(["parsedAt", "startOffset", "endOffset"]);

// A string fingerprint of the listener-visible portion of store state. Two
// states with the same signature produce an identical panel render, so the
// notification can be skipped. The volatile positional/timestamp keys above are
// dropped; everything else (statuses, text, reviewers, selection, sweep state)
// is compared. Insertion order is stable because every state object is built by
// the same code paths, so structurally-equal states stringify identically.
function renderSignature(state: ReviewStoreState): string {
	return JSON.stringify(state, (key, value) =>
		VOLATILE_RENDER_SIGNATURE_KEYS.has(key) ? undefined : value,
	);
}

export class ReviewStore {
	private readonly listeners = new Set<Listener>();

	private state: ReviewStoreState = {
		acknowledgedCompletedSweepBatchId: null,
		appliedReview: null,
		completedSweep: null,
		guidedSweep: null,
		selectedSuggestionId: null,
		session: null,
	};

	// Batch depth + pending-emit flag let multi-step transitions emit exactly
	// once. emit() defers while depth > 0; the outermost batch() flushes a
	// single notification if anything actually changed. try/finally guarantees
	// depth resets even if the batched function throws.
	private batchDepth = 0;
	private pendingEmit = false;

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.getState());
		return () => {
			this.listeners.delete(listener);
		};
	}

	getState(): ReviewStoreState {
		return {
			acknowledgedCompletedSweepBatchId: this.state.acknowledgedCompletedSweepBatchId,
			appliedReview: this.state.appliedReview
				? {
						...this.state.appliedReview,
						entries: this.state.appliedReview.entries.map((entry) => ({ ...entry })),
					}
				: null,
			completedSweep: this.state.completedSweep
				? {
						...this.state.completedSweep,
						notePaths: [...this.state.completedSweep.notePaths],
					}
				: null,
			guidedSweep: this.state.guidedSweep
				? {
						...this.state.guidedSweep,
						notePaths: [...this.state.guidedSweep.notePaths],
					}
				: null,
			selectedSuggestionId: this.state.selectedSuggestionId,
			session: this.state.session
				? {
						...this.state.session,
						suggestions: [...this.state.session.suggestions],
					}
				: null,
		};
	}

	getSession(): ReviewSession | null {
		return this.state.session;
	}

	getGuidedSweep(): GuidedSweepState | null {
		return this.state.guidedSweep;
	}

	getCompletedSweep(): CompletedSweepState | null {
		return this.state.completedSweep;
	}

	getAcknowledgedCompletedSweepBatchId(): string | null {
		return this.state.acknowledgedCompletedSweepBatchId;
	}

	getAppliedReview(): AppliedReviewState | null {
		return this.state.appliedReview;
	}

	getSelectedSuggestion(): ReviewSuggestion | null {
		const session = this.state.session;
		if (!session || !this.state.selectedSuggestionId) {
			return null;
		}

		return session.suggestions.find((suggestion) => suggestion.id === this.state.selectedSuggestionId) ?? null;
	}

	setSession(session: ReviewSession, preferredSelectionId?: string | null): void {
		const firstOpenSuggestion = session.suggestions.find(
			(suggestion) =>
				suggestion.status !== "accepted" &&
				suggestion.status !== "rejected" &&
				suggestion.status !== "rewritten",
		);
		const selectedSuggestionId =
			preferredSelectionId && session.suggestions.some((suggestion) => suggestion.id === preferredSelectionId)
				? preferredSelectionId
				: firstOpenSuggestion?.id ?? session.suggestions[0]?.id ?? null;

		const previousSignature = renderSignature(this.state);
		this.state = {
			acknowledgedCompletedSweepBatchId: firstOpenSuggestion ? null : this.state.acknowledgedCompletedSweepBatchId,
			appliedReview: this.state.appliedReview,
			completedSweep:
				this.state.completedSweep &&
				this.state.completedSweep.notePaths.includes(session.notePath) &&
				!firstOpenSuggestion
					? this.state.completedSweep
					: null,
			guidedSweep: this.state.guidedSweep,
			session,
			selectedSuggestionId,
		};
		// The per-keystroke resync rebuilds the session and lands here even when
		// the author is only editing prose: the new session carries a fresh
		// parsedAt and shifted offsets but renders identically. State is updated
		// (so any later reveal uses current offsets); the notification is skipped
		// when nothing listener-visible changed, eliminating the panel flicker.
		if (renderSignature(this.state) === previousSignature) {
			return;
		}
		this.emit();
	}

	clearSession(): void {
		this.state = {
			acknowledgedCompletedSweepBatchId: this.state.acknowledgedCompletedSweepBatchId,
			appliedReview: null,
			completedSweep: this.state.completedSweep,
			guidedSweep: this.state.guidedSweep,
			session: null,
			selectedSuggestionId: null,
		};
		this.emit();
	}

	selectSuggestion(id: string | null): void {
		const session = this.state.session;
		const selectedSuggestionId = session?.suggestions.some((suggestion) => suggestion.id === id) ? id : null;
		this.state = {
			...this.state,
			selectedSuggestionId,
		};
		this.emit();
	}

	replaceSuggestions(suggestions: ReviewSuggestion[]): void {
		if (!this.state.session) {
			return;
		}

		const session: ReviewSession = {
			...this.state.session,
			suggestions,
		};

		const selectedSuggestionId = suggestions.some((suggestion) => suggestion.id === this.state.selectedSuggestionId)
			? this.state.selectedSuggestionId
			: suggestions[0]?.id ?? null;

		this.state = {
			acknowledgedCompletedSweepBatchId: this.state.acknowledgedCompletedSweepBatchId,
			appliedReview: this.state.appliedReview,
			completedSweep: this.state.completedSweep,
			guidedSweep: this.state.guidedSweep,
			session,
			selectedSuggestionId,
		};
		this.emit();
	}

	setGuidedSweep(guidedSweep: GuidedSweepState | null): void {
		this.state = {
			...this.state,
			guidedSweep,
			acknowledgedCompletedSweepBatchId: guidedSweep ? null : this.state.acknowledgedCompletedSweepBatchId,
			completedSweep: guidedSweep ? null : this.state.completedSweep,
		};
		this.emit();
	}

	setCompletedSweep(completedSweep: CompletedSweepState | null): void {
		this.state = {
			...this.state,
			acknowledgedCompletedSweepBatchId:
				completedSweep && this.state.acknowledgedCompletedSweepBatchId === completedSweep.batchId
					? null
					: this.state.acknowledgedCompletedSweepBatchId,
			completedSweep,
		};
		this.emit();
	}

	acknowledgeCompletedSweep(batchId: string | null): void {
		this.state = {
			...this.state,
			acknowledgedCompletedSweepBatchId: batchId,
		};
		this.emit();
	}

	setAppliedReview(appliedReview: AppliedReviewState | null): void {
		if (this.state.appliedReview === appliedReview) {
			return;
		}

		if (!appliedReview && !this.state.appliedReview) {
			return;
		}

		if (
			appliedReview &&
			this.state.appliedReview &&
			appliedReview.notePath === this.state.appliedReview.notePath &&
			appliedReview.currentIndex === this.state.appliedReview.currentIndex &&
			appliedReview.entries.length === this.state.appliedReview.entries.length &&
			appliedReview.entries.every((entry, index) => {
				const current = this.state.appliedReview?.entries[index];
				return Boolean(
					current
					&& current.start === entry.start
					&& current.end === entry.end
					&& current.suggestionId === entry.suggestionId,
				);
			})
		) {
			return;
		}

		this.state = {
			...this.state,
			appliedReview,
		};
		this.emit();
	}

	updateAppliedReviewCurrentIndex(currentIndex: number): void {
		if (!this.state.appliedReview) {
			return;
		}

		const safeIndex = Math.max(0, Math.min(currentIndex, this.state.appliedReview.entries.length - 1));
		if (safeIndex === this.state.appliedReview.currentIndex) {
			return;
		}

		this.state = {
			...this.state,
			appliedReview: {
				...this.state.appliedReview,
				currentIndex: safeIndex,
			},
		};
		this.emit();
	}

	updateGuidedSweepCurrentNote(notePath: string): void {
		const guidedSweep = this.state.guidedSweep;
		if (!guidedSweep) {
			return;
		}

		const currentNoteIndex = guidedSweep.notePaths.findIndex((candidate) => candidate === notePath);
		if (currentNoteIndex === -1 || currentNoteIndex === guidedSweep.currentNoteIndex) {
			return;
		}

		this.state = {
			...this.state,
			guidedSweep: {
				...guidedSweep,
				currentNoteIndex,
			},
		};
		this.emit();
	}

	updateSuggestionStatus(id: string, status: ReviewStatus): void {
		if (!this.state.session) {
			return;
		}

		this.replaceSuggestions(
			this.state.session.suggestions.map((suggestion) =>
				suggestion.id === id
					? {
							...suggestion,
							status,
						}
					: suggestion,
			),
		);
	}

	updateMemoStatus(id: string, status: AuthorQueryStatus): void {
		if (!this.state.session) {
			return;
		}
		const memos = this.state.session.memos.map((memo) =>
			memo.id === id ? { ...memo, status } : memo,
		);
		this.state = {
			...this.state,
			session: { ...this.state.session, memos },
		};
		this.emit();
	}

	batch(fn: () => void): void {
		this.batchDepth += 1;
		try {
			fn();
		} finally {
			this.batchDepth -= 1;
			if (this.batchDepth === 0 && this.pendingEmit) {
				this.pendingEmit = false;
				const snapshot = this.getState();
				this.listeners.forEach((listener) => listener(snapshot));
			}
		}
	}

	private emit(): void {
		if (this.batchDepth > 0) {
			this.pendingEmit = true;
			return;
		}
		const snapshot = this.getState();
		this.listeners.forEach((listener) => listener(snapshot));
	}
}
