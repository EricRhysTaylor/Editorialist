import { describe, it, expect } from "vitest";
import { MatchEngine } from "./MatchEngine";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { SuggestionParser } from "./SuggestionParser";

function buildEditSuggestion(original: string, revised: string) {
  const parser = new SuggestionParser(new ContributorDirectory());
  const note = `\`\`\`editorialist-review
Reviewer: GPT-5.4
ReviewerType: ai-editor

=== EDIT ===
SceneId: scn_test
Original: ${original}
Revised: ${revised}
Why: testing
\`\`\``;
  const parsed = parser.parse(note);
  const suggestion = parsed.suggestions[0];
  if (!suggestion) throw new Error("expected one suggestion");
  return suggestion;
}

describe("MatchEngine — already-applied detection", () => {
  it("detects add-only edit already applied at the start (prefix add)", () => {
    const noteText = "Shail exhales. She knew it. \"I'm a participant of the Tourney.\"";
    const original = "She knew it. \"I'm a participant of the Tourney.\"";
    const revised = "Shail exhales. She knew it. \"I'm a participant of the Tourney.\"";
    const suggestion = buildEditSuggestion(original, revised);
    const matched = new MatchEngine().matchSuggestion(noteText, suggestion);
    expect(matched.location.primary?.matchType).toBe("already_applied");
  });

  it("detects add-only edit already applied as suffix (suffix add)", () => {
    const noteText = "She nods. Then she walks away.";
    const original = "She nods.";
    const revised = "She nods. Then she walks away.";
    const suggestion = buildEditSuggestion(original, revised);
    const matched = new MatchEngine().matchSuggestion(noteText, suggestion);
    expect(matched.location.primary?.matchType).toBe("already_applied");
  });

  it("still matches exact when the add-only edit has NOT been applied", () => {
    const noteText = "She knew it. \"I'm a participant of the Tourney.\"";
    const original = "She knew it. \"I'm a participant of the Tourney.\"";
    const revised = "Shail exhales. She knew it. \"I'm a participant of the Tourney.\"";
    const suggestion = buildEditSuggestion(original, revised);
    const matched = new MatchEngine().matchSuggestion(noteText, suggestion);
    expect(matched.location.primary?.matchType).toBe("exact");
  });

  it("detects condense already-applied when the multi-line AFTER lives in the manuscript", () => {
    const after = [
      "Cesena has one, the lucky girl. Or rather, her parents do.",
      "They guard it carefully, let Cesena use it only under supervision,",
      "and account for every gram of input matter.",
    ].join("\n");
    const before = [
      "Cesena has one, the lucky girl. Or, more accurately, her parents own one.",
      "And they guard it quite carefully. Cesena only gets to use it in their presence.",
      "It's not a thing to be trifled with.",
    ].join("\n");

    const parser = new SuggestionParser(new ContributorDirectory());
    const note = `\`\`\`editorialist-review
Reviewer: GPT-5.4
ReviewerType: ai-editor

=== CONDENSE ===
SceneId: scn_test
Target:
${before}
Suggestion:
${after}
Why: tightening
\`\`\``;
    const parsed = parser.parse(note);
    const suggestion = parsed.suggestions[0];
    if (!suggestion) throw new Error("expected one suggestion");

    const noteText = `Prelude unrelated.\n\n${after}\n\nPostlude unrelated.`;
    const matched = new MatchEngine().matchSuggestion(noteText, suggestion);
    expect(matched.location.target?.matchType).toBe("already_applied");
  });

  it("resolves a condense anchor pair to the verbatim slice between the anchors", () => {
    const passage = "She wonders, briefly, why she hasn't been rescued. The forest answers nothing. Whatever is happening, it isn't reaching her.";
    const noteText = `Prelude unrelated.\n\n${passage}\n\nPostlude unrelated.`;

    const parser = new SuggestionParser(new ContributorDirectory());
    const note = `\`\`\`editorialist-review
Reviewer: GPT-5.4
ReviewerType: ai-editor

=== CONDENSE ===
SceneId: scn_test
Target: "She wonders, briefly" → "isn't reaching her."
Suggestion: tighter beat
Why: drag
\`\`\``;
    const suggestion = parser.parse(note).suggestions[0];
    if (!suggestion || suggestion.operation !== "condense") throw new Error("expected condense suggestion");

    const matched = new MatchEngine().matchSuggestion(noteText, suggestion);
    expect(matched.location.target?.matchType).toBe("exact");
    expect(matched.location.target?.startOffset).toBe(noteText.indexOf("She wonders"));
    expect(matched.location.target?.endOffset).toBe(noteText.indexOf(passage) + passage.length);
    if (matched.operation === "condense") {
      expect(matched.payload.target).toBe(passage);
    }
  });

  it("marks condense unresolved when one anchor is missing", () => {
    const noteText = "She wonders, briefly, why she hasn't been rescued. The forest answers nothing.";

    const parser = new SuggestionParser(new ContributorDirectory());
    const note = `\`\`\`editorialist-review
Reviewer: GPT-5.4
ReviewerType: ai-editor

=== CONDENSE ===
SceneId: scn_test
Target: "She wonders, briefly" → "isn't reaching her."
Suggestion: tighter beat
Why: drag
\`\`\``;
    const suggestion = parser.parse(note).suggestions[0];
    if (!suggestion || suggestion.operation !== "condense") throw new Error("expected condense suggestion");

    const matched = new MatchEngine().matchSuggestion(noteText, suggestion);
    expect(matched.location.target?.matchType).toBe("none");
    expect(matched.status).toBe("unresolved");
  });

  it("detects condense already-applied across smart-vs-straight quote drift", () => {
    const afterCurly = "She nods. “I know,” she says.";
    const afterStraight = "She nods. \"I know,\" she says.";
    const before = "She nods deeply. \"I know, of course I do,\" she says.";

    const parser = new SuggestionParser(new ContributorDirectory());
    const note = `\`\`\`editorialist-review
Reviewer: GPT-5.4
ReviewerType: ai-editor

=== CONDENSE ===
SceneId: scn_test
Target:
${before}
Suggestion:
${afterCurly}
Why: tightening
\`\`\``;
    const parsed = parser.parse(note);
    const suggestion = parsed.suggestions[0];
    if (!suggestion) throw new Error("expected one suggestion");

    const noteText = `Something before.\n${afterStraight}\nSomething after.`;
    const matched = new MatchEngine().matchSuggestion(noteText, suggestion);
    expect(matched.location.target?.matchType).toBe("already_applied");
  });

  it("resolves an expand target to an exact match in the manuscript", () => {
    const target = "She looked away and said nothing.";
    const noteText = `Prelude unrelated.\n\n${target}\n\nPostlude unrelated.`;

    const parser = new SuggestionParser(new ContributorDirectory());
    const note = `\`\`\`editorialist-review
Reviewer: GPT-5.4
ReviewerType: ai-editor

=== EXPAND ===
SceneId: scn_test
Target: ${target}
Suggestion: She looked away, jaw tightening, and let the silence stretch.
Why: develop the beat
\`\`\``;
    const suggestion = parser.parse(note).suggestions[0];
    if (!suggestion || suggestion.operation !== "expand") throw new Error("expected expand suggestion");

    const matched = new MatchEngine().matchSuggestion(noteText, suggestion);
    expect(matched.location.target?.matchType).toBe("exact");
    expect(matched.location.target?.startOffset).toBe(noteText.indexOf(target));
    expect(matched.status).toBe("pending");
  });

  it("detects expand already-applied when the expanded version lives in the manuscript", () => {
    const after = "She looked away, jaw tightening, and let the silence stretch before she said nothing.";
    const before = "She looked away and said nothing.";

    const parser = new SuggestionParser(new ContributorDirectory());
    const note = `\`\`\`editorialist-review
Reviewer: GPT-5.4
ReviewerType: ai-editor

=== EXPAND ===
SceneId: scn_test
Target: ${before}
Suggestion: ${after}
Why: develop the beat
\`\`\``;
    const suggestion = parser.parse(note).suggestions[0];
    if (!suggestion) throw new Error("expected one suggestion");

    const noteText = `Prelude unrelated.\n\n${after}\n\nPostlude unrelated.`;
    const matched = new MatchEngine().matchSuggestion(noteText, suggestion);
    expect(matched.location.target?.matchType).toBe("already_applied");
  });
});
