export interface LineWithOffsets {
	endOffset: number;
	startOffset: number;
	text: string;
}

export function getLinesWithOffsets(text: string, baseOffset: number): LineWithOffsets[] {
	const lines: LineWithOffsets[] = [];
	const linePattern = /.*(?:\r?\n|$)/g;
	let match: RegExpExecArray | null;

	while ((match = linePattern.exec(text)) !== null) {
		const rawLine = match[0];
		if (rawLine.length === 0) {
			break;
		}

		const newlineMatch = rawLine.match(/\r?\n$/);
		const newlineLength = newlineMatch?.[0].length ?? 0;
		const textOnly = newlineLength > 0 ? rawLine.slice(0, -newlineLength) : rawLine;
		const startOffset = baseOffset + match.index;
		const endOffset = startOffset + textOnly.length;

		lines.push({
			text: textOnly,
			startOffset,
			endOffset,
		});

		if (linePattern.lastIndex >= text.length) {
			break;
		}
	}

	return lines;
}
