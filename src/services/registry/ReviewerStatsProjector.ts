// Reviewer-stat projection, extracted verbatim from ReviewRegistryService.
// Owns the COMPUTATION only: the authoritative recompute
// (rebuildReviewerStatsFromSignals), the incremental delta
// (applyReviewerSignalDelta), the pure record/key builders, and the
// session-reconciliation algorithm. It does NOT own the signal index or
// persistence — the service still holds reviewerSignalIndex, decides
// didChange -> assign + persistData, and resolves note identities (vault
// access stays in the service). Behavior — including the deliberate
// incremental-vs-authoritative duality the Pass-2 invariant guards — is
// byte-identical.
//
// Note-identity resolution is injected (resolveNoteIdentities) because
// getNoteIdentityKeys is vault-coupled shared infra also used by the
// decision index; it must not move here.

import type { ReviewSession, ReviewSuggestion } from "../../models/ReviewSuggestion";
import type { ReviewerSignalRecord, ReviewerStats } from "../../models/ContributorProfile";
import type { ContributorDirectory } from "../../state/ContributorDirectory";
import { getEffectiveSuggestionStatus, getSuggestionSignatureParts } from "../../core/OperationSupport";

export interface ReconcileSessionResult {
	nextIndex: Record<string, ReviewerSignalRecord>;
	didChange: boolean;
}

export class ReviewerStatsProjector {
	constructor(private readonly directory: ContributorDirectory) {}

	// Authoritative recompute: zero every known profile, then tally the whole
	// signal index. (was ReviewRegistryService.rebuildReviewerStatsFromSignals)
	rebuildFromSignals(signalIndex: Record<string, ReviewerSignalRecord>): void {
		const profiles = this.directory.getProfiles();
		const totalsByReviewerId = new Map<string, ReviewerStats>();

		for (const profile of profiles) {
			totalsByReviewerId.set(profile.id, {
				totalSuggestions: 0,
				accepted: 0,
				pending: 0,
				deferred: 0,
				rejected: 0,
				rewritten: 0,
				unresolved: 0,
				acceptedEdits: 0,
				acceptedMoves: 0,
			});
		}

		for (const record of Object.values(signalIndex)) {
			const stats = totalsByReviewerId.get(record.reviewerId);
			if (!stats) {
				continue;
			}

			stats.totalSuggestions += 1;
			switch (record.status) {
				case "accepted":
					stats.accepted += 1;
					if (record.operation === "move") {
						stats.acceptedMoves = (stats.acceptedMoves ?? 0) + 1;
					} else if (record.operation === "edit" || record.operation === "cut" || record.operation === "condense" || record.operation === "expand") {
						stats.acceptedEdits = (stats.acceptedEdits ?? 0) + 1;
					}
					break;
				case "pending":
					stats.pending = (stats.pending ?? 0) + 1;
					break;
				case "deferred":
					stats.deferred += 1;
					break;
				case "rejected":
					stats.rejected += 1;
					break;
				case "rewritten":
					stats.rewritten += 1;
					break;
				case "unresolved":
					stats.unresolved += 1;
					break;
			}
		}

		for (const [reviewerId, stats] of totalsByReviewerId) {
			this.directory.setStats(reviewerId, stats);
		}
	}

	// Incremental ±1 delta applied directly to a profile's stats.
	// (was ReviewRegistryService.applyReviewerSignalDelta)
	applyDelta(record: ReviewerSignalRecord, direction: 1 | -1): void {
		const profile = this.directory.getProfileById(record.reviewerId);
		if (!profile) {
			return;
		}

		const stats = {
			totalSuggestions: profile.stats?.totalSuggestions ?? 0,
			accepted: profile.stats?.accepted ?? 0,
			pending: profile.stats?.pending ?? 0,
			deferred: profile.stats?.deferred ?? 0,
			rejected: profile.stats?.rejected ?? 0,
			rewritten: profile.stats?.rewritten ?? 0,
			unresolved: profile.stats?.unresolved ?? 0,
			acceptedEdits: profile.stats?.acceptedEdits ?? 0,
			acceptedMoves: profile.stats?.acceptedMoves ?? 0,
		};

		stats.totalSuggestions = Math.max(0, stats.totalSuggestions + direction);
		if (record.status === "accepted") {
			stats.accepted = Math.max(0, stats.accepted + direction);
			if (record.operation === "move") {
				stats.acceptedMoves = Math.max(0, (stats.acceptedMoves ?? 0) + direction);
			} else if (record.operation === "edit" || record.operation === "cut" || record.operation === "condense" || record.operation === "expand") {
				stats.acceptedEdits = Math.max(0, (stats.acceptedEdits ?? 0) + direction);
			}
		} else if (record.status === "pending") {
			stats.pending = Math.max(0, (stats.pending ?? 0) + direction);
		} else if (record.status === "rejected") {
			stats.rejected = Math.max(0, stats.rejected + direction);
		} else if (record.status === "rewritten") {
			stats.rewritten = Math.max(0, stats.rewritten + direction);
		} else if (record.status === "deferred") {
			stats.deferred = Math.max(0, stats.deferred + direction);
		} else {
			stats.unresolved = Math.max(0, stats.unresolved + direction);
		}

		this.directory.setStats(record.reviewerId, stats);
	}

	// Pure. (was ReviewRegistryService.createReviewerSignalRecord)
	createSignalRecord(
		key: string,
		suggestion: ReviewSuggestion,
		sessionId?: string,
		sessionStartedAt?: number,
	): ReviewerSignalRecord | null {
		const reviewerId = suggestion.contributor.reviewerId;
		if (!reviewerId) {
			return null;
		}

		return {
			key,
			reviewerId,
			status:
				getEffectiveSuggestionStatus(suggestion) === "accepted"
					? "accepted"
					: getEffectiveSuggestionStatus(suggestion) === "pending"
						? "pending"
					: getEffectiveSuggestionStatus(suggestion) === "rejected"
						? "rejected"
						: getEffectiveSuggestionStatus(suggestion) === "rewritten"
							? "rewritten"
						: getEffectiveSuggestionStatus(suggestion) === "deferred"
							? "deferred"
							: "unresolved",
			operation: suggestion.operation,
			sessionId,
			sessionStartedAt,
		};
	}

	// Pure. (was ReviewRegistryService.sameReviewerSignalRecord)
	sameSignalRecord(
		left: ReviewerSignalRecord | undefined,
		right: ReviewerSignalRecord | null,
	): boolean {
		if (!left && !right) {
			return true;
		}

		if (!left || !right) {
			return false;
		}

		return (
			left.key === right.key &&
			left.reviewerId === right.reviewerId &&
			left.status === right.status &&
			left.operation === right.operation &&
			left.sessionId === right.sessionId &&
			left.sessionStartedAt === right.sessionStartedAt
		);
	}

	// Pure given the note identities. (was ReviewRegistryService.createReviewerSignalKeys,
	// with getNoteIdentityKeys lifted to the injected resolver.)
	private signalKeysFor(noteIdentities: string[], suggestion: ReviewSuggestion): string[] {
		return noteIdentities.map((noteIdentity) =>
			[
				noteIdentity,
				suggestion.source.blockIndex,
				suggestion.source.entryIndex,
				suggestion.operation,
				suggestion.executionMode,
				...getSuggestionSignatureParts(suggestion),
			].join("::"),
		);
	}

	// The session reconciliation. Returns the next index + didChange; applies
	// the ±1 deltas to the directory exactly as the inlined version did. The
	// caller owns the `if (!session) return` guard, the index assignment, and
	// persistence. (was the body of ReviewRegistryService.syncReviewerSignalsForSession)
	reconcileSession(
		currentIndex: Record<string, ReviewerSignalRecord>,
		session: ReviewSession,
		resolveNoteIdentities: (notePath: string) => string[],
		options?: { sessionId?: string; sessionStartedAt?: number },
	): ReconcileSessionResult {
		let didChange = false;
		const nextIndex = {
			...currentIndex,
		};
		const activeKeys = new Set<string>();
		const noteIdentities = resolveNoteIdentities(session.notePath);

		for (const suggestion of session.suggestions) {
			const candidateKeys = this.signalKeysFor(noteIdentities, suggestion);
			const key = candidateKeys[0];
			if (!key) {
				continue;
			}
			activeKeys.add(key);
			const existingRecord = candidateKeys
				.map((candidate) => nextIndex[candidate])
				.find((record): record is ReviewerSignalRecord => Boolean(record));
			const desiredRecord = this.createSignalRecord(
				key,
				suggestion,
				options?.sessionId,
				options?.sessionStartedAt,
			);

			if (this.sameSignalRecord(existingRecord, desiredRecord)) {
				continue;
			}

			if (existingRecord) {
				this.applyDelta(existingRecord, -1);
				delete nextIndex[existingRecord.key];
				didChange = true;
			}

			for (const candidate of candidateKeys) {
				if (candidate === key || !nextIndex[candidate]) {
					continue;
				}

				this.applyDelta(nextIndex[candidate] as ReviewerSignalRecord, -1);
				delete nextIndex[candidate];
				didChange = true;
			}

			if (desiredRecord) {
				this.applyDelta(desiredRecord, 1);
				nextIndex[key] = desiredRecord;
				didChange = true;
			}
		}

		const keyPrefixes = noteIdentities.map((identity) => `${identity}::`);
		for (const [key, existingRecord] of Object.entries(nextIndex)) {
			if (!keyPrefixes.some((prefix) => key.startsWith(prefix)) || activeKeys.has(key)) {
				continue;
			}

			this.applyDelta(existingRecord, -1);
			delete nextIndex[key];
			didChange = true;
		}

		return { nextIndex, didChange };
	}
}
