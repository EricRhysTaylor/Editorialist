export function findExactMatches(noteText: string, text: string): number[] {
	if (!text) {
		return [];
	}

	const matches: number[] = [];
	let searchFrom = 0;

	while (searchFrom < noteText.length) {
		const index = noteText.indexOf(text, searchFrom);
		if (index === -1) {
			break;
		}

		matches.push(index);
		searchFrom = index + text.length;
	}

	return matches;
}

export function normalizeMatchText(value: string): string {
	return value.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

export function countNormalizedMatches(noteText: string, text: string): number {
	const normalizedText = normalizeMatchText(noteText);
	const normalizedTarget = normalizeMatchText(text);
	if (!normalizedText || !normalizedTarget) {
		return 0;
	}

	let count = 0;
	let searchFrom = 0;
	while (searchFrom < normalizedText.length) {
		const index = normalizedText.indexOf(normalizedTarget, searchFrom);
		if (index === -1) {
			break;
		}

		count += 1;
		searchFrom = index + normalizedTarget.length;
	}

	return count;
}
