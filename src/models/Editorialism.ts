// Editorialism — a manuscript-level / arc-level editorial agenda.
// Lives as a markdown file under `Editorialist/<Book>/<Title>.md`.
// The author's source of truth is the markdown; Editorialist parses + renders.

export type EditorialismItemStatus =
	| "open"
	| "in-progress"
	| "done"
	| "deferred"
	| "question";

export type EditorialismScopeKind = "manuscript" | "scene" | "range" | "arc" | "unknown";

export interface EditorialismItemScope {
	kind: EditorialismScopeKind;
	scene?: string;
	start?: string;
	end?: string;
	arcName?: string;
	raw: string;
}

export interface EditorialismItem {
	lineIndex: number;
	status: EditorialismItemStatus;
	text: string;
	scope: EditorialismItemScope | null;
	tags: string[];
}

export interface EditorialismSection {
	heading: string;
	items: EditorialismItem[];
}

export interface Editorialism {
	filePath: string;
	title: string;
	book: string | null;
	status: string | null;
	created: string | null;
	sections: EditorialismSection[];
}

export interface EditorialismSummary {
	filePath: string;
	title: string;
	book: string | null;
	status: string | null;
	totalItems: number;
	doneItems: number;
	mtime: number;
}
