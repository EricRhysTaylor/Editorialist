import { describe, it, expect } from "vitest";
import { getLinesWithOffsets } from "./TextOffsets";

describe("getLinesWithOffsets", () => {
	it("returns nothing for an empty string", () => {
		expect(getLinesWithOffsets("", 0)).toEqual([]);
	});

	it("handles a single line with no trailing newline", () => {
		expect(getLinesWithOffsets("abc", 0)).toEqual([
			{ text: "abc", startOffset: 0, endOffset: 3 },
		]);
	});

	it("a trailing newline does NOT produce a trailing empty line", () => {
		expect(getLinesWithOffsets("abc\n", 0)).toEqual([
			{ text: "abc", startOffset: 0, endOffset: 3 },
		]);
	});

	it("offsets are contiguous across lines and exclude the newline", () => {
		expect(getLinesWithOffsets("a\nbb\nccc", 0)).toEqual([
			{ text: "a", startOffset: 0, endOffset: 1 },
			{ text: "bb", startOffset: 2, endOffset: 4 },
			{ text: "ccc", startOffset: 5, endOffset: 8 },
		]);
	});

	it("preserves interior blank lines as zero-length spans", () => {
		expect(getLinesWithOffsets("a\n\nb", 0)).toEqual([
			{ text: "a", startOffset: 0, endOffset: 1 },
			{ text: "", startOffset: 2, endOffset: 2 },
			{ text: "b", startOffset: 3, endOffset: 4 },
		]);
	});

	it("a lone newline yields one empty line at the base offset", () => {
		expect(getLinesWithOffsets("\n", 0)).toEqual([
			{ text: "", startOffset: 0, endOffset: 0 },
		]);
	});

	it("handles CRLF: the carriage return is excluded from text and offsets", () => {
		expect(getLinesWithOffsets("a\r\nbb", 0)).toEqual([
			{ text: "a", startOffset: 0, endOffset: 1 },
			{ text: "bb", startOffset: 3, endOffset: 5 },
		]);
	});

	it("applies the base offset to every span", () => {
		expect(getLinesWithOffsets("ab\ncd", 10)).toEqual([
			{ text: "ab", startOffset: 10, endOffset: 12 },
			{ text: "cd", startOffset: 13, endOffset: 15 },
		]);
	});
});
