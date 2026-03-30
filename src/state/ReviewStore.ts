import type { ReviewSession, ReviewSuggestion, ReviewStatus } from "../models/ReviewSuggestion";

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
	appliedReview: AppliedReviewState | null;
	completedSweep: CompletedSweepState | null;
	guidedSweep: GuidedSweepState | null;
	selectedSuggestionId: string | null;
	session: ReviewSession | null;
}

type Listener = (state: ReviewStoreState) => void;

export class ReviewStore {
	private readonly listeners = new Set<Listener>();

	private state: ReviewStoreState = {
		appliedReview: null,
		completedSweep: null,
		guidedSweep: null,
		selectedSuggestionId: null,
		session: null,
	};

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.getState());
		return () => {
			this.listeners.delete(listener);
		};
	}

	getState(): ReviewStoreState {
		return {
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

		this.state = {
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
		this.emit();
	}

	clearSession(): void {
		this.state = {
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
			completedSweep: guidedSweep ? null : this.state.completedSweep,
		};
		this.emit();
	}

	setCompletedSweep(completedSweep: CompletedSweepState | null): void {
		this.state = {
			...this.state,
			completedSweep,
		};
		this.emit();
	}

	setAppliedReview(appliedReview: AppliedReviewState | null): void {
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

	private emit(): void {
		const snapshot = this.getState();
		this.listeners.forEach((listener) => listener(snapshot));
	}
}
