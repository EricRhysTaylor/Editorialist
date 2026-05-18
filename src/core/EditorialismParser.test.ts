import { describe, it, expect } from "vitest";
import {
	markerFromStatus,
	parseEditorialism,
	parseScope,
	rewriteTaskMarker,
	statusFromMarker,
} from "./EditorialismParser";
import type { EditorialismItemStatus } from "../models/Editorialism";

const ALL_STATUSES: EditorialismItemStatus[] = [
	"open",
	"in-progress",
	"done",
	"deferred",
	"question",
];

describe("statusFromMarker / markerFromStatus", () => {
	it("maps known markers", () => {
		expect(statusFromMarker("x")).toBe("done");
		expect(statusFromMarker("X")).toBe("done");
		expect(statusFromMarker("/")).toBe("in-progress");
		expect(statusFromMarker("-")).toBe("deferred");
		expect(statusFromMarker("?")).toBe("question");
	});

	it("treats space / unknown markers as open", () => {
		expect(statusFromMarker(" ")).toBe("open");
		expect(statusFromMarker("z")).toBe("open");
	});

	it("round-trips status -> marker -> status for every status", () => {
		for (const status of ALL_STATUSES) {
			expect(statusFromMarker(markerFromStatus(status))).toBe(status);
		}
	});
});

describe("parseScope", () => {
	it("recognizes manuscript aliases", () => {
		for (const raw of ["manuscript", "MSS", "Book"]) {
			expect(parseScope(raw).kind).toBe("manuscript");
		}
	});

	it("parses arc scope and trims the arc name", () => {
		expect(parseScope("arc:  Redemption ")).toEqual({
			kind: "arc",
			arcName: "Redemption",
			raw: "arc:  Redemption",
		});
	});

	it("parses numeric range scope", () => {
		expect(parseScope("12 - 15")).toEqual({
			kind: "range",
			start: "12",
			end: "15",
			raw: "12 - 15",
		});
	});

	it("parses a single scene scope", () => {
		expect(parseScope("42")).toEqual({ kind: "scene", scene: "42", raw: "42" });
	});

	it("falls back to unknown", () => {
		expect(parseScope("somewhere").kind).toBe("unknown");
	});
});

describe("parseEditorialism", () => {
	it("uses frontmatter title/book/status/created and starts the body after the fence", () => {
		const md = [
			"---",
			'title: "My Agenda"',
			"book: Book One",
			"status: active",
			"created: 2026-01-01",
			"---",
			"## Pacing",
			"- [ ] tighten the opening [scope:: 12-15] [tags:: pacing, opening]",
		].join("\n");

		const result = parseEditorialism("Editorialist/Book One/agenda.md", md);
		expect(result.title).toBe("My Agenda");
		expect(result.book).toBe("Book One");
		expect(result.status).toBe("active");
		expect(result.created).toBe("2026-01-01");
		expect(result.sections).toHaveLength(1);

		const section = result.sections[0];
		expect(section.heading).toBe("Pacing");
		expect(section.items).toHaveLength(1);

		const item = section.items[0];
		expect(item.status).toBe("open");
		expect(item.text).toBe("tighten the opening");
		expect(item.scope).toEqual({ kind: "range", start: "12", end: "15", raw: "12-15" });
		expect(item.tags).toEqual(["pacing", "opening"]);
		expect(item.lineIndex).toBe(7);
	});

	it("derives the title from a level-1 heading when no frontmatter title", () => {
		const md = ["# Heading Title", "## Section A", "- [x] done task"].join("\n");
		const result = parseEditorialism("x/agenda.md", md);
		expect(result.title).toBe("Heading Title");
		expect(result.sections).toHaveLength(1);
		expect(result.sections[0].heading).toBe("Section A");
		expect(result.sections[0].items[0].status).toBe("done");
	});

	it("falls back to the file basename for the title", () => {
		const result = parseEditorialism("Editorialist/Book/My File.md", "- [ ] orphan task");
		expect(result.title).toBe("My File");
		expect(result.sections[0].heading).toBe("Items");
		expect(result.sections[0].items).toHaveLength(1);
	});

	it("ignores non-task, non-heading lines", () => {
		const md = ["## S", "some prose", "- [/] real task", "more prose"].join("\n");
		const result = parseEditorialism("a.md", md);
		expect(result.sections[0].items).toHaveLength(1);
		expect(result.sections[0].items[0].status).toBe("in-progress");
	});

	it("treats an unterminated frontmatter fence as body", () => {
		const md = ["---", "title: Nope", "## Section", "- [ ] task"].join("\n");
		const result = parseEditorialism("base.md", md);
		expect(result.title).toBe("base");
		expect(result.sections[0].heading).toBe("Section");
	});
});

describe("rewriteTaskMarker", () => {
	it("rewrites the marker while preserving indentation and body", () => {
		const md = ["## S", "  - [ ] nested task"].join("\n");
		const out = rewriteTaskMarker(md, 1, "done");
		expect(out).toBe(["## S", "  - [x] nested task"].join("\n"));
	});

	it("normalizes spacing but keeps the body text", () => {
		const out = rewriteTaskMarker("- [ ]   spaced", 0, "question");
		expect(out).toBe("- [?] spaced");
	});

	it("returns the original content for an out-of-range line index", () => {
		const md = "- [ ] only line";
		expect(rewriteTaskMarker(md, 5, "done")).toBe(md);
		expect(rewriteTaskMarker(md, -1, "done")).toBe(md);
	});

	it("returns the original content when the target line is not a task", () => {
		const md = ["## Heading", "- [ ] task"].join("\n");
		expect(rewriteTaskMarker(md, 0, "done")).toBe(md);
	});
});
