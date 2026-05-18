import { describe, it, expect } from "vitest";
import {
	REVIEW_STATUSES,
	isDeferredStatus,
	isOpenStatus,
	isResolvedStatus,
	isTerminalStatus,
	isUnresolvedStatus,
	normalizeReviewDecisionStatus,
	normalizeReviewStatus,
	normalizeSceneStatus,
	normalizeSweepStatus,
	reviewStatusLabel,
	sweepStatusLabel,
} from "./ReviewStatusModel";

describe("ReviewStatusModel — legacy normalization", () => {
	it("maps legacy review-decision status 'later' to 'deferred'", () => {
		expect(normalizeReviewDecisionStatus("later")).toBe("deferred");
	});

	it("passes through valid review-decision statuses", () => {
		expect(normalizeReviewDecisionStatus("accepted")).toBe("accepted");
		expect(normalizeReviewDecisionStatus("rejected")).toBe("rejected");
		expect(normalizeReviewDecisionStatus("rewritten")).toBe("rewritten");
		expect(normalizeReviewDecisionStatus("deferred")).toBe("deferred");
	});

	it("defaults unknown/missing review-decision status to 'deferred'", () => {
		expect(normalizeReviewDecisionStatus(undefined)).toBe("deferred");
		expect(normalizeReviewDecisionStatus("bogus")).toBe("deferred");
		expect(normalizeReviewDecisionStatus("pending")).toBe("deferred");
	});

	it("maps legacy scene status 'not_started' to 'in_progress' and defaults unknown", () => {
		expect(normalizeSceneStatus("not_started")).toBe("in_progress");
		expect(normalizeSceneStatus("completed")).toBe("completed");
		expect(normalizeSceneStatus("cleaned")).toBe("cleaned");
		expect(normalizeSceneStatus("in_progress")).toBe("in_progress");
		expect(normalizeSceneStatus(undefined)).toBe("in_progress");
		expect(normalizeSceneStatus("???")).toBe("in_progress");
	});

	it("maps legacy sweep statuses 'cleaned_up'/'imported' and defaults unknown", () => {
		expect(normalizeSweepStatus("cleaned_up")).toBe("cleaned");
		expect(normalizeSweepStatus("imported")).toBe("in_progress");
		expect(normalizeSweepStatus("completed")).toBe("completed");
		expect(normalizeSweepStatus("cleaned")).toBe("cleaned");
		expect(normalizeSweepStatus(undefined)).toBe("in_progress");
		expect(normalizeSweepStatus("xyz")).toBe("in_progress");
	});

	it("normalizes review status with 'later' alias and safe 'pending' fallback", () => {
		expect(normalizeReviewStatus("later")).toBe("deferred");
		expect(normalizeReviewStatus("accepted")).toBe("accepted");
		expect(normalizeReviewStatus("unresolved")).toBe("unresolved");
		expect(normalizeReviewStatus(undefined)).toBe("pending");
		expect(normalizeReviewStatus("nope")).toBe("pending");
	});
});

describe("ReviewStatusModel — status buckets", () => {
	it("classifies every known status into exactly open xor resolved", () => {
		for (const status of REVIEW_STATUSES) {
			expect(isResolvedStatus(status)).toBe(!isOpenStatus(status));
		}
	});

	it("open = pending | deferred | unresolved", () => {
		expect(isOpenStatus("pending")).toBe(true);
		expect(isOpenStatus("deferred")).toBe(true);
		expect(isOpenStatus("unresolved")).toBe(true);
		expect(isOpenStatus("accepted")).toBe(false);
		expect(isOpenStatus("rejected")).toBe(false);
		expect(isOpenStatus("rewritten")).toBe(false);
	});

	it("terminal = accepted | rejected | rewritten", () => {
		expect(isTerminalStatus("accepted")).toBe(true);
		expect(isTerminalStatus("rejected")).toBe(true);
		expect(isTerminalStatus("rewritten")).toBe(true);
		expect(isTerminalStatus("pending")).toBe(false);
		expect(isTerminalStatus("deferred")).toBe(false);
		expect(isTerminalStatus("unresolved")).toBe(false);
	});

	it("deferred / unresolved single-status predicates", () => {
		expect(isDeferredStatus("deferred")).toBe(true);
		expect(isDeferredStatus("pending")).toBe(false);
		expect(isUnresolvedStatus("unresolved")).toBe(true);
		expect(isUnresolvedStatus("pending")).toBe(false);
	});

	it("for the current vocabulary, terminal and resolved coincide", () => {
		for (const status of REVIEW_STATUSES) {
			expect(isTerminalStatus(status)).toBe(isResolvedStatus(status));
		}
	});
});

describe("ReviewStatusModel — labels", () => {
	it("returns a non-empty label for every status", () => {
		for (const status of REVIEW_STATUSES) {
			expect(reviewStatusLabel(status).length).toBeGreaterThan(0);
		}
		expect(sweepStatusLabel("in_progress")).toBe("In progress");
		expect(sweepStatusLabel("completed")).toBe("Completed");
		expect(sweepStatusLabel("cleaned")).toBe("Cleaned");
	});
});
