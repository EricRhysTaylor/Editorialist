import type { App } from "obsidian";
import {
	buildSceneItems,
	hasPendingEdits,
} from "./PendingEditsSegments";
import type { PendingEditsSession } from "../models/PendingEditSegment";

const RADIAL_TIMELINE_PLUGIN_ID = "radial-timeline";

interface RadialTimelineSceneLike {
	path?: string;
	title?: string;
	number?: number;
	pendingEdits?: string;
	itemType?: string;
}

interface RadialTimelineBookLike {
	id: string;
	title: string;
	sourceFolder: string;
}

interface RadialTimelinePluginSurface {
	getActiveBook?: () => RadialTimelineBookLike | undefined | null;
	getSceneData?: (options?: { sourcePath?: string }) => Promise<RadialTimelineSceneLike[]>;
}

interface AppWithPlugins extends App {
	plugins: {
		getPlugin: (id: string) => unknown;
	};
}

export type CollectPendingEditsResult =
	| { ok: true; session: PendingEditsSession }
	| { ok: false; reason: CollectFailureReason };

export type CollectFailureReason =
	| "radial_timeline_missing"
	| "radial_timeline_api_unavailable"
	| "no_active_book"
	| "no_scenes_with_pending_edits";

// Radial Timeline's getSceneData currently returns `number: undefined` for
// every Scene item, so the sweep order can't rely on it. Scene files are named
// with a leading manuscript number (e.g. "50 Leaving Earth"), which is the
// order the writer expects to walk. Parse that leading number from the title;
// honor an explicit numeric `number` if a future RT version supplies one; fall
// back to the source array index only when no number can be found.
export function resolveSceneOrder(
	rawNumber: number | undefined,
	title: string,
	fallbackIndex: number,
): number {
	if (typeof rawNumber === "number" && Number.isFinite(rawNumber)) {
		return rawNumber;
	}
	const leadingNumber = /^\s*(\d+(?:\.\d+)?)/.exec(title)?.[1];
	if (leadingNumber) {
		return Number.parseFloat(leadingNumber);
	}
	return fallbackIndex;
}

function resolveRadialTimelinePlugin(app: App): RadialTimelinePluginSurface | null {
	const candidate = (app as AppWithPlugins).plugins?.getPlugin?.(RADIAL_TIMELINE_PLUGIN_ID);
	if (!candidate) {
		return null;
	}

	return candidate;
}

export async function collectPendingEdits(app: App): Promise<CollectPendingEditsResult> {
	const plugin = resolveRadialTimelinePlugin(app);
	if (!plugin) {
		return { ok: false, reason: "radial_timeline_missing" };
	}

	if (typeof plugin.getActiveBook !== "function" || typeof plugin.getSceneData !== "function") {
		return { ok: false, reason: "radial_timeline_api_unavailable" };
	}

	const activeBook = plugin.getActiveBook();
	if (!activeBook) {
		return { ok: false, reason: "no_active_book" };
	}

	const scenes = await plugin.getSceneData({ sourcePath: activeBook.sourceFolder });

	const sceneInputs = scenes
		.filter((scene): scene is RadialTimelineSceneLike & { path: string } => {
			if (!scene.path) return false;
			if (scene.itemType && scene.itemType !== "Scene") return false;
			return hasPendingEdits(scene.pendingEdits);
		})
		.map((scene, index) => {
			const title = scene.title?.trim() || scene.path;
			return {
				path: scene.path,
				title,
				order: resolveSceneOrder(scene.number, title, index),
				rawField: scene.pendingEdits ?? "",
			};
		});

	const sceneItems = buildSceneItems(sceneInputs);

	if (sceneItems.length === 0) {
		return { ok: false, reason: "no_scenes_with_pending_edits" };
	}

	const firstSegmentId = sceneItems[0]?.segments[0]?.id ?? null;

	return {
		ok: true,
		session: {
			bookId: activeBook.id,
			bookTitle: activeBook.title,
			sourceFolder: activeBook.sourceFolder,
			collectedAt: Date.now(),
			scenes: sceneItems,
			selectedSegmentId: firstSegmentId,
		},
	};
}

export function describeCollectFailure(reason: CollectFailureReason): string {
	switch (reason) {
		case "radial_timeline_missing":
			return "Radial Timeline plugin is not installed or enabled.";
		case "radial_timeline_api_unavailable":
			return "Radial Timeline is installed but does not expose the expected API (getActiveBook / getSceneData). Update Radial Timeline.";
		case "no_active_book":
			return "No active book selected in Radial Timeline.";
		case "no_scenes_with_pending_edits":
			return "No scenes in the active book have pending edits.";
	}
}
