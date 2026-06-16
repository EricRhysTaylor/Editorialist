import { describe, expect, it } from "vitest";
import { extractEditorialismFileFromText } from "./EditorialismImport";

const FILE_BODY = [
	"---",
	"type: editorialism",
	"title: IT Subplot Integration",
	"book: Shail + Trisan",
	"status: in-progress",
	"created: 2026-06-15",
	"---",
	"",
	"# IT Subplot Integration",
	"",
	"## Fabrication Logic",
	"- [ ] Hold the rule everywhere [scope:: manuscript] [tags:: doctrine]",
	"- [x] Repoint 51 to the wolf pistol [scope:: 51]",
].join("\n");

describe("extractEditorialismFileFromText", () => {
	it("returns null when there is no editorialism file", () => {
		expect(extractEditorialismFileFromText("just some prose")).toBeNull();
		expect(extractEditorialismFileFromText("")).toBeNull();
	});

	it("extracts a fenced ```editorialism block with title and book", () => {
		const paste = ["Here is the file:", "", "```editorialism", FILE_BODY, "```", "", "trailing chat"].join("\n");
		const result = extractEditorialismFileFromText(paste);
		expect(result).not.toBeNull();
		expect(result?.title).toBe("IT Subplot Integration");
		expect(result?.book).toBe("Shail + Trisan");
		expect(result?.content).toBe(FILE_BODY);
		// Trailing chat is NOT included for the fenced path.
		expect(result?.content).not.toContain("trailing chat");
	});

	it("extracts an unfenced file via the type: editorialism frontmatter", () => {
		const paste = ["Some preamble.", "", FILE_BODY].join("\n");
		const result = extractEditorialismFileFromText(paste);
		expect(result?.title).toBe("IT Subplot Integration");
		expect(result?.book).toBe("Shail + Trisan");
		expect(result?.content.startsWith("---")).toBe(true);
		expect(result?.content).toContain("## Fabrication Logic");
		// Preamble before the frontmatter is excluded.
		expect(result?.content).not.toContain("Some preamble");
	});

	it("ignores a non-editorialism frontmatter block and finds the editorialism one", () => {
		const decoy = ["---", "type: scene", "id: scn_1", "---", "", "Body."].join("\n");
		const paste = [decoy, "", FILE_BODY].join("\n");
		const result = extractEditorialismFileFromText(paste);
		expect(result?.title).toBe("IT Subplot Integration");
		expect(result?.content).not.toContain("type: scene");
	});

	it("does not treat a fenced block lacking editorialism frontmatter as a match", () => {
		const paste = ["```editorialism", "# No frontmatter here", "- [ ] item", "```"].join("\n");
		expect(extractEditorialismFileFromText(paste)).toBeNull();
	});

	it("falls back to the first heading for the title when frontmatter omits it", () => {
		const noTitle = [
			"---",
			"type: editorialism",
			"book: Shail + Trisan",
			"---",
			"",
			"# Derived From Heading",
			"- [ ] item [scope:: 1]",
		].join("\n");
		const result = extractEditorialismFileFromText(noTitle);
		expect(result?.title).toBe("Derived From Heading");
	});

	it("returns a null book when frontmatter omits it", () => {
		const noBook = ["---", "type: editorialism", "title: Loose Notes", "---", "", "# Loose Notes"].join("\n");
		const result = extractEditorialismFileFromText(noBook);
		expect(result?.book).toBeNull();
		expect(result?.title).toBe("Loose Notes");
	});
});
