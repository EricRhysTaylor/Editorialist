// Persisted review-decision keying / lookup / application, extracted
// verbatim from ReviewRegistryService. Stateless: the service still OWNS
// the `reviewDecisionIndex` map and all persistence decisions — it passes
// the live index into each method and persists when the method reports a
// mutation. Note-identity resolution (vault/workspace coupled) is injected
// so this module stays free of Obsidian. Behavior — including the legacy
// fallback key, the in-place key migration when only the key shape changed,
// and the dedupe of identical key shapes — is byte-identical.
//
// The protecting tests are the Pass-2 service invariants
// (ReviewRegistryService.invariants.test.ts: every decision key resolves
// to a session suggestion; re-persisting same status is idempotent;
// load->build->load round-trip), the state-machine golden traces, plus
// direct unit tests in ReviewDecisionIndex.test.ts.

import { getLegacyContributorSignatureKind } from "../../core/ContributorIdentity";
import { getSuggestionSignatureParts } from "../../core/OperationSupport";
import type { PersistedReviewDecisionRecord } from "../../models/ContributorProfile";
import type { ReviewSession, ReviewSuggestion } from "../../models/ReviewSuggestion";

export interface ReviewDecisionIndexDeps {
	// Note-identity is vault-coupled (the service may add a `scene:<id>` head
	// when a scene id resolves). Injected so this module owns no vault access.
	noteIdentitiesOf(notePath: string): string[];
	now?: () => number;
}

type Index = Record<string, PersistedReviewDecisionRecord>;

export class ReviewDecisionIndex {
	private readonly now: () => number;

	constructor(private readonly deps: ReviewDecisionIndexDeps) {
		this.now = deps.now ?? (() => Date.now());
	}

	// Pure key derivation. Two key shapes per note identity:
	//   1. Canonical: raw contributor fields (rawName / rawType / rawProvider / rawModel)
	//   2. Legacy fallback: displayName + legacy contributor-kind signature
	// Duplicate shapes are collapsed (some suggestions produce identical
	// canonical+legacy strings); preserves the original `filter(indexOf)` dedupe.
	// (was ReviewRegistryService.createPersistedReviewDecisionKeys)
	keysFor(notePath: string, suggestion: ReviewSuggestion): string[] {
		const keys: string[] = [];
		for (const noteIdentity of this.deps.noteIdentitiesOf(notePath)) {
			keys.push(
				[
					noteIdentity,
					suggestion.operation,
					suggestion.executionMode,
					suggestion.contributor.raw.rawName ?? "",
					suggestion.contributor.raw.rawType ?? "",
					suggestion.contributor.raw.rawProvider ?? "",
					suggestion.contributor.raw.rawModel ?? "",
					...getSuggestionSignatureParts(suggestion),
					suggestion.why ?? "",
				].join("::"),
			);
			keys.push(
				[
					noteIdentity,
					suggestion.operation,
					suggestion.executionMode,
					suggestion.contributor.displayName,
					getLegacyContributorSignatureKind(suggestion.contributor),
					...getSuggestionSignatureParts(suggestion),
					suggestion.why ?? "",
				].join("::"),
			);
		}

		return keys.filter((key, index) => keys.indexOf(key) === index);
	}

	// (was ReviewRegistryService.getPersistedReviewDecisionRecord)
	getRecord(
		index: Index,
		notePath: string,
		suggestion: ReviewSuggestion,
	): PersistedReviewDecisionRecord | undefined {
		for (const key of this.keysFor(notePath, suggestion)) {
			const record = index[key];
			if (record) {
				return record;
			}
		}

		return undefined;
	}

	// (was ReviewRegistryService.applyPersistedReviewState)
	applyTo(index: Index, session: ReviewSession): ReviewSession {
		return {
			...session,
			suggestions: session.suggestions.map((suggestion) => {
				const record = this.getRecord(index, session.notePath, suggestion);
				if (!record) {
					return suggestion;
				}

				return {
					...suggestion,
					status: record.status,
				};
			}),
		};
	}

	// Mutates `index` in place; returns whether the caller should persist.
	// Three branches preserved exactly:
	//   - no key derivable -> no-op (false)
	//   - same status already at the canonical key -> no-op (false)
	//   - same status at a stale (legacy) key -> migrate to canonical (true)
	//   - real change -> drop legacy variants, write canonical record (true)
	// (was ReviewRegistryService.persistReviewDecision body)
	persist(
		index: Index,
		notePath: string,
		suggestion: ReviewSuggestion,
		status: PersistedReviewDecisionRecord["status"],
		options?: { sessionId?: string; sessionStartedAt?: number },
	): boolean {
		const keys = this.keysFor(notePath, suggestion);
		const key = keys[0];
		if (!key) {
			return false;
		}
		const existing = keys
			.map((candidate) => index[candidate])
			.find((record): record is PersistedReviewDecisionRecord => Boolean(record));
		if (existing?.status === status) {
			if (existing.key !== key) {
				delete index[existing.key];
				index[key] = {
					...existing,
					key,
				};
				return true;
			}
			return false;
		}

		for (const candidate of keys) {
			if (candidate !== key) {
				delete index[candidate];
			}
		}

		index[key] = {
			key,
			status,
			updatedAt: this.now(),
			sessionId: options?.sessionId,
			sessionStartedAt: options?.sessionStartedAt,
		};
		return true;
	}

	// Mutates `index` in place; returns whether anything was removed (so the
	// caller knows to persist).
	// (was ReviewRegistryService.clearPersistedReviewDecision body)
	clear(index: Index, notePath: string, suggestion: ReviewSuggestion): boolean {
		const keys = this.keysFor(notePath, suggestion);
		let removed = false;
		for (const key of keys) {
			if (!index[key]) {
				continue;
			}

			delete index[key];
			removed = true;
		}
		return removed;
	}
}
