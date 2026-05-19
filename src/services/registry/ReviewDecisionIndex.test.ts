// Direct unit tests for the extracted decision-index module. The Pass-2
// service invariants (every persisted decision key resolves to a session
// suggestion; re-persisting same status is idempotent; load->build->load
// round-trip) remain the primary safety net; these pin the module's own
// contracts: key generation incl. dedupe + scene-id head, legacy-key
// fallback resolution, in-place key migration when only the key shape
// changes, clear/apply behavior, and the persist-return contract that
// drives the service's "should I persist" decision.

import { describe, it, expect } from "vitest";
import { ReviewDecisionIndex } from "./ReviewDecisionIndex";
import type { PersistedReviewDecisionRecord } from "../../models/ContributorProfile";
import type { ReviewSession, ReviewSuggestion } from "../../models/ReviewSuggestion";

const FIXED_NOW = 1_700_000_000_000;

let seq = 0;
function suggestion(over: Partial<ReviewSuggestion["contributor"]["raw"]> = {}): ReviewSuggestion {
	seq += 1;
	const s = seq;
	return {
		id: `s${s}`,
		operation: "edit",
		status: "pending",
		location: { primary: { text: `o${s}`, startOffset: 0, endOffset: 2, matchType: "exact" } },
		source: { blockIndex: 0, entryIndex: s },
		executionMode: "direct",
		contributor: {
			id: "r1",
			displayName: "Reviewer One",
			kind: "ai",
			reviewerType: "ai-editor",
			reviewerId: "r1",
			resolutionStatus: "exact",
			suggestedReviewerIds: [],
			raw: { rawName: "raw-r1", rawType: "ai-editor", rawProvider: "openai", rawModel: "gpt-4", ...over },
		},
		payload: { original: `o${s}`, revised: `r${s}` },
	} as ReviewSuggestion;
}

function session(notePath: string, suggestions: ReviewSuggestion[]): ReviewSession {
	return { notePath, hasReviewBlock: true, parsedAt: FIXED_NOW, suggestions, memos: [] };
}

function makeIndex(noteIdentities: (notePath: string) => string[] = (p) => [p]) {
	return new ReviewDecisionIndex({ noteIdentitiesOf: noteIdentities, now: () => FIXED_NOW });
}

describe("ReviewDecisionIndex.keysFor", () => {
	it("includes one canonical + one legacy key per note identity, deduped", () => {
		const i = makeIndex(() => ["scene:S1", "n.md"]);
		const keys = i.keysFor("n.md", suggestion());
		expect(keys.length).toBe(4); // 2 identities x (canonical + legacy)
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys[0].startsWith("scene:S1::")).toBe(true);
		expect(keys[2].startsWith("n.md::")).toBe(true);
	});

	it("collapses canonical and legacy keys when they are identical strings", () => {
		const sug = suggestion();
		// Force the legacy fallback shape to match canonical by aligning the
		// raw/display fields. (Legacy shape uses contributor.displayName +
		// kind-signature in place of the raw-* fields; identical strings dedupe.)
		const dupSug = { ...sug, contributor: { ...sug.contributor, displayName: "raw-r1", raw: { ...sug.contributor.raw, rawType: undefined, rawProvider: undefined, rawModel: undefined } } } as ReviewSuggestion;
		const i = makeIndex();
		const keys = i.keysFor("n.md", dupSug);
		// At minimum the dedupe pass runs; both shapes per identity may collapse.
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("ReviewDecisionIndex.persist", () => {
	it("returns false (no mutation) when no key derives", () => {
		const i = new ReviewDecisionIndex({ noteIdentitiesOf: () => [] });
		const index = {};
		expect(i.persist(index, "n.md", suggestion(), "accepted")).toBe(false);
		expect(Object.keys(index)).toHaveLength(0);
	});

	it("writes a fresh record (changed=true), stamps now/session fields", () => {
		const i = makeIndex();
		const index: Record<string, PersistedReviewDecisionRecord> = {};
		expect(i.persist(index, "n.md", suggestion(), "accepted", { sessionId: "S", sessionStartedAt: 7 })).toBe(true);
		const record = Object.values(index)[0];
		expect(record).toMatchObject({ status: "accepted", updatedAt: FIXED_NOW, sessionId: "S", sessionStartedAt: 7 });
	});

	it("is idempotent when the same status is already at the canonical key (changed=false)", () => {
		const i = makeIndex();
		const sug = suggestion();
		const index: Record<string, PersistedReviewDecisionRecord> = {};
		expect(i.persist(index, "n.md", sug, "rejected")).toBe(true); // fresh write
		const before = JSON.stringify(index);
		expect(i.persist(index, "n.md", sug, "rejected")).toBe(false); // idempotent
		expect(i.persist(index, "n.md", sug, "rejected")).toBe(false);
		expect(JSON.stringify(index)).toBe(before);
	});

	it("MIGRATES a stale legacy-key record to the canonical key (changed=true) without changing status", () => {
		const i = makeIndex();
		const sug = suggestion();
		const allKeys = i.keysFor("n.md", sug);
		const canonical = allKeys[0];
		const legacy = allKeys[1]; // distinct from canonical
		expect(legacy).not.toBe(canonical);

		const index: Record<string, PersistedReviewDecisionRecord> = {
			[legacy]: { key: legacy, status: "deferred", updatedAt: 1 },
		};
		expect(i.persist(index, "n.md", sug, "deferred")).toBe(true);
		expect(index[canonical]).toMatchObject({ key: canonical, status: "deferred", updatedAt: 1 });
		expect(index[legacy]).toBeUndefined();
	});

	it("drops legacy variants and writes the new record on a real status change", () => {
		const i = makeIndex();
		const sug = suggestion();
		const allKeys = i.keysFor("n.md", sug);
		const index: Record<string, PersistedReviewDecisionRecord> = {
			[allKeys[1]]: { key: allKeys[1], status: "deferred", updatedAt: 1 },
		};
		expect(i.persist(index, "n.md", sug, "accepted")).toBe(true);
		expect(index[allKeys[1]]).toBeUndefined();
		expect(index[allKeys[0]]).toMatchObject({ status: "accepted", updatedAt: FIXED_NOW });
	});
});

describe("ReviewDecisionIndex.clear", () => {
	it("removes all key variants present and returns true; returns false when nothing matched", () => {
		const i = makeIndex();
		const sug = suggestion();
		const keys = i.keysFor("n.md", sug);
		const index: Record<string, PersistedReviewDecisionRecord> = {
			[keys[0]]: { key: keys[0], status: "accepted", updatedAt: 1 },
			[keys[1]]: { key: keys[1], status: "accepted", updatedAt: 1 },
		};
		expect(i.clear(index, "n.md", sug)).toBe(true);
		expect(Object.keys(index)).toHaveLength(0);
		expect(i.clear(index, "n.md", sug)).toBe(false);
	});
});

describe("ReviewDecisionIndex.applyTo / getRecord", () => {
	it("applyTo overlays persisted status onto each matching session suggestion", () => {
		const i = makeIndex();
		const a = suggestion();
		const b = suggestion();
		const aKeys = i.keysFor("n.md", a);
		const bKeys = i.keysFor("n.md", b);
		const index: Record<string, PersistedReviewDecisionRecord> = {
			[aKeys[0]]: { key: aKeys[0], status: "rejected", updatedAt: 1 },
			[bKeys[0]]: { key: bKeys[0], status: "rewritten", updatedAt: 1 },
		};
		const out = i.applyTo(index, session("n.md", [a, b]));
		expect(out.suggestions[0].status).toBe("rejected");
		expect(out.suggestions[1].status).toBe("rewritten");
	});

	it("getRecord prefers the canonical key but falls back to the legacy variant", () => {
		const i = makeIndex();
		const sug = suggestion();
		const keys = i.keysFor("n.md", sug);
		expect(i.getRecord({ [keys[1]]: { key: keys[1], status: "deferred", updatedAt: 1 } }, "n.md", sug)?.status).toBe("deferred");
	});
});
