import { describe, it, expect } from "vitest";
import {
	REVIEW_FIELD_PATTERN,
	REVIEW_METADATA_KEYS,
	REVIEW_OPERATION_KEYWORDS,
	REVIEW_SECTION_HEADER_PATTERN,
	normalizeReviewFieldKey,
} from "./ReviewBlockGrammar";

describe("ReviewBlockGrammar — section header pattern", () => {
	it("matches every operation keyword under every opening decoration", () => {
		for (const op of REVIEW_OPERATION_KEYWORDS) {
			for (const line of [
				`=== ${op} ===`,
				`--- ${op} ---`,
				`## ${op}`,
				`*** ${op} ***`,
				`[${op}]`,
			]) {
				expect(REVIEW_SECTION_HEADER_PATTERN.test(line)).toBe(true);
			}
		}
	});

	it("captures the operation keyword case-insensitively", () => {
		const match = "=== edit ===".match(REVIEW_SECTION_HEADER_PATTERN);
		expect(match?.[1]?.toUpperCase()).toBe("EDIT");
	});

	it("does not match plain prose or bare field lines", () => {
		expect(REVIEW_SECTION_HEADER_PATTERN.test("Reviewer: GPT-5")).toBe(false);
		expect(REVIEW_SECTION_HEADER_PATTERN.test("just some text")).toBe(false);
	});
});

describe("ReviewBlockGrammar — field pattern + key normalization", () => {
	it("splits a Key: value line and tolerates spaces in the key", () => {
		const match = "Scene Id:  scn_1".match(REVIEW_FIELD_PATTERN);
		expect(match?.[1]).toBe("Scene Id");
		expect(match?.[2]).toBe("scn_1");
	});

	it("normalizes field keys to lowercase, whitespace-stripped", () => {
		expect(normalizeReviewFieldKey("Scene Id")).toBe("sceneid");
		expect(normalizeReviewFieldKey("  Reviewer Type ")).toBe("reviewertype");
	});

	it("metadata key set is recognized via the normalizer", () => {
		expect(REVIEW_METADATA_KEYS.has(normalizeReviewFieldKey("Batch Id"))).toBe(true);
		expect(REVIEW_METADATA_KEYS.has(normalizeReviewFieldKey("Reviewer Type"))).toBe(true);
		expect(REVIEW_METADATA_KEYS.has(normalizeReviewFieldKey("Original"))).toBe(false);
	});
});
