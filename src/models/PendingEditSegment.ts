export type PendingEditSegmentKind = "human" | "inquiry";

export interface PendingEditSegment {
	id: string;
	kind: PendingEditSegmentKind;
	scenePath: string;
	sceneTitle: string;
	sceneOrder: number;
	text: string;
	lines: string[];
}

export interface PendingEditsSceneItem {
	scenePath: string;
	sceneTitle: string;
	sceneOrder: number;
	rawField: string;
	segments: PendingEditSegment[];
}

export interface PendingEditsSession {
	bookId: string;
	bookTitle: string;
	sourceFolder: string;
	collectedAt: number;
	scenes: PendingEditsSceneItem[];
	selectedSegmentId: string | null;
}
