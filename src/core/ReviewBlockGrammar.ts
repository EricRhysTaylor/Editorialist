// Shared grammar for review blocks: the section-header pattern, metadata key
// set, and field-key normalizer. Previously these were copy-pasted across
// SuggestionParser, ReviewBlockFormat, and PasteNormalizer and drifted
// independently. This module is the single source so the paste-in format and
// the re-parse format can never disagree.

// MEMO and QUERY are not editable operations (they never apply to the prose),
// but they are section-header keywords the grammar must recognize so the parser
// and paste-normalizer route them. QUERY carries an author's `%%ai: …%%`
// question and the model's answer; see SceneMemo.kind.
export const REVIEW_OPERATION_KEYWORDS = ["EDIT", "MOVE", "CUT", "CONDENSE", "EXPAND", "MEMO", "QUERY"] as const;
export type ReviewOperationKeyword = (typeof REVIEW_OPERATION_KEYWORDS)[number];

const OPS = REVIEW_OPERATION_KEYWORDS.join("|");

// A section header with an opening decoration (===, ---, #, ***, or [) and an
// optional, not-necessarily-symmetric closing decoration. Carries the `m` flag
// (inert for the single trimmed lines every caller passes; harmless if a
// caller ever tests a multi-line string).
export const REVIEW_SECTION_HEADER_PATTERN = new RegExp(
	`^\\s*(?:={2,}|-{2,}|#{1,6}|\\*{1,3}|\\[)\\s*(${OPS})\\s*(?:={2,}|-{2,}|#{1,6}|\\*{1,3}|\\])?\\s*$`,
	"im",
);

// A generic `Key: value` field line where the key may contain spaces.
export const REVIEW_FIELD_PATTERN = /^([A-Za-z][A-Za-z ]+):\s*(.*)$/;

export const REVIEW_METADATA_KEYS: ReadonlySet<string> = new Set([
	"batchid",
	"importedby",
	"template",
	"templateyear",
	"supportedoperations",
	"sceneidsource",
	"reviewer",
	"reviewertype",
	"provider",
	"model",
]);

export function normalizeReviewFieldKey(value: string): string {
	return value.toLowerCase().replace(/\s+/g, "");
}
