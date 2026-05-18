// Single source of truth for review / sweep status vocabulary, legacy
// normalization, labels, and grouping. Canonical types remain defined in
// src/models (to avoid creating yet another parallel type); this module owns
// the *behavior* around them — migration of legacy persisted strings and the
// open/terminal/resolved/deferred/unresolved buckets that completion logic and
// summaries depend on.

import type {
	PersistedReviewDecisionRecord,
	SceneReviewRecord,
} from "../../models/ReviewerProfile";
import type { ReviewStatus } from "../../models/ReviewSuggestion";
import type { ReviewSweepStatus } from "../../models/ReviewImport";

export type { ReviewStatus, ReviewSweepStatus };

export const REVIEW_STATUSES: readonly ReviewStatus[] = [
	"pending",
	"accepted",
	"rejected",
	"deferred",
	"unresolved",
	"rewritten",
] as const;

export const REVIEW_SWEEP_STATUSES: readonly ReviewSweepStatus[] = [
	"in_progress",
	"completed",
	"cleaned",
] as const;

const REVIEW_STATUS_SET = new Set<string>(REVIEW_STATUSES);
const SWEEP_STATUS_SET = new Set<string>(REVIEW_SWEEP_STATUSES);

// ---------------------------------------------------------------------------
// Legacy normalization
//
// Each mapping mirrors behavior previously inlined in ReviewRegistryService's
// normalize* methods. Defaults are preserved exactly so persisted data loads
// identically.
// ---------------------------------------------------------------------------

/** Persisted review-decision status. Legacy: `"later"` → `"deferred"`. Default `"deferred"`. */
export function normalizeReviewDecisionStatus(
	raw: unknown,
): PersistedReviewDecisionRecord["status"] {
	if (raw === "later") {
		return "deferred";
	}
	if (raw === "accepted" || raw === "deferred" || raw === "rejected" || raw === "rewritten") {
		return raw;
	}
	return "deferred";
}

/** Scene-review record status. Legacy: `"not_started"` → `"in_progress"`. Default `"in_progress"`. */
export function normalizeSceneStatus(raw: unknown): SceneReviewRecord["status"] {
	if (raw === "not_started") {
		return "in_progress";
	}
	if (raw === "completed" || raw === "cleaned" || raw === "in_progress") {
		return raw;
	}
	return "in_progress";
}

/**
 * Sweep-registry status. Legacy: `"cleaned_up"` → `"cleaned"`, `"imported"` →
 * `"in_progress"`. Default `"in_progress"`.
 */
export function normalizeSweepStatus(raw: unknown): ReviewSweepStatus {
	if (raw === "cleaned_up") {
		return "cleaned";
	}
	if (raw === "imported") {
		return "in_progress";
	}
	if (SWEEP_STATUS_SET.has(raw as string)) {
		return raw as ReviewSweepStatus;
	}
	return "in_progress";
}

/**
 * Suggestion review status. Defensive normalization for any future legacy
 * persisted suggestion status. Legacy alias `"later"` → `"deferred"`; unknown
 * values fall back to `"pending"` (the safest open state — it keeps the item
 * visible rather than silently closing it).
 */
export function normalizeReviewStatus(raw: unknown): ReviewStatus {
	if (raw === "later") {
		return "deferred";
	}
	if (REVIEW_STATUS_SET.has(raw as string)) {
		return raw as ReviewStatus;
	}
	return "pending";
}

// ---------------------------------------------------------------------------
// Labels (canonical, context-free)
//
// Generic labels for the status vocabulary. UI surfaces with richer,
// context-dependent phrasing keep their own logic; this is the neutral
// fallback / single naming reference.
// ---------------------------------------------------------------------------

const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
	pending: "Pending",
	accepted: "Accepted",
	rejected: "Rejected",
	deferred: "Deferred",
	unresolved: "Unresolved",
	rewritten: "Rewritten",
};

const REVIEW_SWEEP_STATUS_LABELS: Record<ReviewSweepStatus, string> = {
	in_progress: "In progress",
	completed: "Completed",
	cleaned: "Cleaned",
};

export function reviewStatusLabel(status: ReviewStatus): string {
	return REVIEW_STATUS_LABELS[status];
}

export function sweepStatusLabel(status: ReviewSweepStatus): string {
	return REVIEW_SWEEP_STATUS_LABELS[status];
}

// ---------------------------------------------------------------------------
// Grouping helpers
//
// `open` mirrors the prior `isSuggestionOpen` set (pending / deferred /
// unresolved). `terminal` / `resolved` are the decided set (accepted /
// rejected / rewritten) — the complement of open for the current vocabulary.
// Both names are provided because callers express different intent; they are
// guaranteed consistent: a status is resolved iff it is not open.
// ---------------------------------------------------------------------------

export function isOpenStatus(status: ReviewStatus): boolean {
	return status === "pending" || status === "deferred" || status === "unresolved";
}

export function isTerminalStatus(status: ReviewStatus): boolean {
	return status === "accepted" || status === "rejected" || status === "rewritten";
}

export function isResolvedStatus(status: ReviewStatus): boolean {
	return !isOpenStatus(status);
}

export function isDeferredStatus(status: ReviewStatus): boolean {
	return status === "deferred";
}

export function isUnresolvedStatus(status: ReviewStatus): boolean {
	return status === "unresolved";
}
