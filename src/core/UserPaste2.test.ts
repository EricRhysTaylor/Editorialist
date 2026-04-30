import { describe, it, expect } from "vitest";
import { normalizeImportedReviewText } from "./ReviewBlockFormat";
import { SuggestionParser } from "./SuggestionParser";
import { ReviewerDirectory } from "../state/ReviewerDirectory";

describe("user paste #2 — leading bare fence label", () => {
  it("preserves trailing memo with bullet-list prose after blank lines", () => {
    const paste = `editorialist-review
Template: Editorialist advanced
Reviewer: GPT-5.4

=== EDIT ===
SceneId: scn_a
Original: foo
Revised: bar
Why: tighter

⸻

=== MEMO ===
SceneId: scn_a
Issues:
The hybrid transformation sequence is now strong, but you can push it one step further by clarifying the choice moment:

* Add a clearer beat where she refuses → delays → gives in
* Right now it flows as escalation → inevitability
* You want: moral resistance → collapse → action

This will make the act feel like a defining character moment, not just a survival reflex.`;

    const normalized = normalizeImportedReviewText(paste);
    expect(normalized).not.toBeNull();
    expect(normalized).toContain("=== MEMO ===");
    expect(normalized).toContain("moral resistance");

    const parser = new SuggestionParser(new ReviewerDirectory());
    const parsed = parser.parse(normalized!);
    expect(parsed.suggestions).toHaveLength(1);
    expect(parsed.memos).toHaveLength(1);
  });

  it("strips bare 'editorialist-review' line and parses everything", () => {
    const paste = `editorialist-review
Template: Editorialist advanced
TemplateYear: 2026
SupportedOperations: Edit, Move, Cut, Condense
Reviewer: GPT-5.4
ReviewerType: ai-editor
Provider: OpenAI
Model: GPT-5.4

=== MEMO ===
SceneId: scn_feecc7c8
Strengths:
This revision is a major improvement.

Issues:
Two opportunities remain.

⸻

=== EDIT ===
SceneId: scn_feecc7c8
Original: She wonders where the IT are.
Revised: She wonders where the IT are. Not abandoned.
Why: Sharper read.

⸻

=== EDIT ===
SceneId: scn_feecc7c8
Original: An hour passes.
Revised: An hour passes. Then another.
Why: Time weight.

⸻

=== CONDENSE ===
SceneId: scn_feecc7c8
Target:
She eventually encounters a narrow river.
Suggestion:
She encounters a narrow river.
Why: Sharper rhythm.

⸻

=== MEMO ===
SceneId: scn_feecc7c8
Issues:
The hybrid sequence is strong but the choice can be sharper.`;

    const normalized = normalizeImportedReviewText(paste);
    expect(normalized).not.toBeNull();

    const parser = new SuggestionParser(new ReviewerDirectory());
    const parsed = parser.parse(normalized!);
    expect(parsed.suggestions).toHaveLength(3);
    expect(parsed.memos).toHaveLength(2);
  });
});
