// Direct unit tests for the extracted pure normalization functions. These
// complement the Pass-2 service-level invariants (legacy aliases, null/garbage
// blobs, load->build->load round-trip in ReviewRegistryService.invariants)
// by pinning the function-level contracts that the extraction must preserve:
// legacy enum coercion, Date.now() fallbacks, the resolvedCount->acceptedCount
// migration, the frozen sweep decision counts, and the (deliberate)
// same-reference passthrough for the reviewer-signal index.

import { describe, it, expect } from "vitest";
import {
	normalizeAuthorQueryDecisions,
	normalizeReviewDecisionIndex,
	normalizeReviewerSignalIndex,
	normalizeSceneReviewIndex,
	normalizeSweepRegistry,
} from "./ReviewRegistryNormalization";

describe("normalizeAuthorQueryDecisions", () => {
	it("keeps resolved/dismissed records and stamps the key", () => {
		const out = normalizeAuthorQueryDecisions({
			"a.md::Q1": { status: "resolved", updatedAt: 5 },
			"a.md::Q2": { status: "dismissed", updatedAt: 9 },
		});
		expect(out["a.md::Q1"]).toEqual({ key: "a.md::Q1", status: "resolved", updatedAt: 5 });
		expect(out["a.md::Q2"]?.status).toBe("dismissed");
	});

	it("drops records with an unrecognized or open status", () => {
		const out = normalizeAuthorQueryDecisions({
			open: { status: "open" as unknown as "resolved" },
			junk: { status: "whatever" as unknown as "resolved" },
		});
		expect(Object.keys(out)).toHaveLength(0);
	});

	it("returns {} for null/garbage input", () => {
		expect(normalizeAuthorQueryDecisions(undefined)).toEqual({});
		expect(normalizeAuthorQueryDecisions(null as unknown as undefined)).toEqual({});
	});
});

describe("normalizeReviewDecisionIndex", () => {
	it("coerces legacy 'later' -> 'deferred' and stamps the key", () => {
		const out = normalizeReviewDecisionIndex({
			k1: { status: "later", updatedAt: 5 },
		});
		expect(out.k1).toEqual({
			key: "k1",
			status: "deferred",
			updatedAt: 5,
			sessionId: undefined,
			sessionStartedAt: undefined,
		});
	});

	it("returns {} for null / non-object input", () => {
		expect(normalizeReviewDecisionIndex(undefined)).toEqual({});
		expect(normalizeReviewDecisionIndex(null as never)).toEqual({});
	});
});

describe("normalizeReviewerSignalIndex", () => {
	it("passes a valid object through by reference (no clone — matches prior load())", () => {
		const original = { s1: { key: "s1", reviewerId: "r", status: "accepted", operation: "edit" } } as never;
		expect(normalizeReviewerSignalIndex(original)).toBe(original);
	});

	it("returns {} for undefined", () => {
		expect(normalizeReviewerSignalIndex(undefined)).toEqual({});
	});
});

describe("normalizeSceneReviewIndex", () => {
	it("migrates legacy resolvedCount -> acceptedCount and not_started -> in_progress", () => {
		const out = normalizeSceneReviewIndex({
			"n.md": { resolvedCount: 4, status: "not_started" } as never,
		});
		expect(out["n.md"]?.acceptedCount).toBe(4);
		expect(out["n.md"]?.status).toBe("in_progress");
		expect(out["n.md"]?.notePath).toBe("n.md");
		expect(out["n.md"]?.batchIds).toEqual([]);
	});

	it("prefers explicit acceptedCount over legacy resolvedCount", () => {
		const out = normalizeSceneReviewIndex({
			"n.md": { acceptedCount: 9, resolvedCount: 1 } as never,
		});
		expect(out["n.md"]?.acceptedCount).toBe(9);
	});
});

describe("normalizeSweepRegistry", () => {
	it("coerces legacy statuses and preserves frozen decision counts", () => {
		const out = normalizeSweepRegistry({
			b1: { status: "cleaned_up", acceptedCount: 3, rejectedCount: 2 } as never,
			b2: { status: "imported" } as never,
		});
		expect(out.b1?.status).toBe("cleaned");
		expect(out.b1?.acceptedCount).toBe(3);
		expect(out.b1?.rejectedCount).toBe(2);
		expect(out.b2?.status).toBe("in_progress");
		expect(out.b1?.batchId).toBe("b1");
	});

	it("returns {} for non-object input", () => {
		expect(normalizeSweepRegistry(undefined)).toEqual({});
	});
});
