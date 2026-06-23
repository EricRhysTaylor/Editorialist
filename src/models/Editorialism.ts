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

// Optional effort hints an item can declare via inline metadata, used by the
// revision-effort estimate. `[words:: 1500]`, `[scenes:: 2]`, `[effort:: heavy]`.
// When absent, the estimator falls back to scope-weighted heuristics.
export type EditorialismEffortTier = "light" | "medium" | "heavy";

export interface EditorialismItemEffort {
	words?: number;
	scenes?: number;
	tier?: EditorialismEffortTier;
}

export interface EditorialismItem {
	lineIndex: number;
	status: EditorialismItemStatus;
	text: string;
	scope: EditorialismItemScope | null;
	tags: string[];
	effort?: EditorialismItemEffort;
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
