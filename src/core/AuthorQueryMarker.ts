// Single source for the author-query marker syntax — a hidden `%%ai: …%%`
// comment the author leaves inline. Case-insensitive, whitespace-tolerant,
// non-greedy to the closing `%%`. The required `ai:` prefix spares ordinary
// `%% notes %%` and Editorialist's own `%% editorialist-cut … %%` blocks.
export const AUTHOR_QUERY_PATTERN = /%%\s*ai\s*:\s*([\s\S]*?)%%/gi;

// Stable identity for a query within a note: note path + the question text
// (whitespace-collapsed to match the parser's cleaned value). Used to key the
// persisted authorQueryDecisions index.
export function authorQueryKey(notePath: string, question: string): string {
	return `${notePath}::${question.trim().replace(/\s+/g, " ")}`;
}

// A regex that locates the specific `%%ai: <question>%%` marker for one query
// in a note body, so resolving can strip exactly that marker. Whitespace
// between words is matched loosely (`\s+`) because the stored question is
// collapsed while the note marker may wrap across lines. Not global — callers
// remove a single occurrence.
export function buildAuthorQueryMarkerPattern(question: string): RegExp {
	const escaped = question
		.trim()
		.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\s+/g, "\\s+");
	return new RegExp(`%%\\s*ai\\s*:\\s*${escaped}\\s*%%`, "i");
}
