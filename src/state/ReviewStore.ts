import type { ReviewSession, ReviewSuggestion, ReviewStatus } from "../models/ReviewSuggestion";

export interface GuidedSweepState {
	batchId: string;
	currentNoteIndex: number;
	notePaths: string[];
	startedAt: number;
}

export interface ReviewStoreState {
	guidedSweep: GuidedSweepState | null;
	selectedSuggestionId: string | null;
	session: ReviewSession | null;
}

type Listener = (state: ReviewStoreState) => void;

export class ReviewStore {
	private readonly listeners = new Set<Listener>();

	private state: ReviewStoreState = {
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

	getSelectedSuggestion(): ReviewSuggestion | null {
		const session = this.state.session;
		if (!session || !this.state.selectedSuggestionId) {
			return null;
		}

		return session.suggestions.find((suggestion) => suggestion.id === this.state.selectedSuggestionId) ?? null;
	}

	setSession(session: ReviewSession, preferredSelectionId?: string | null): void {
		const firstOpenSuggestion = session.suggestions.find(
			(suggestion) => suggestion.status !== "accepted" && suggestion.status !== "rejected",
		);
		const selectedSuggestionId =
			preferredSelectionId && session.suggestions.some((suggestion) => suggestion.id === preferredSelectionId)
				? preferredSelectionId
				: firstOpenSuggestion?.id ?? session.suggestions[0]?.id ?? null;

		this.state = {
			guidedSweep: this.state.guidedSweep,
			session,
			selectedSuggestionId,
		};
		this.emit();
	}

	clearSession(): void {
		this.state = {
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
