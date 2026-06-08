// Owns the pending-edits subsystem: the active pending-edits session, the
// debounced summary, segment navigation/complete/skip, the pending-edits
// toolbar projection, and the inquiry-brief context cache (including the
// in-flight request set and the Pass-1 leak fix that clears both maps on
// session START, on session close, AND on plugin teardown). Extracted
// verbatim from EditorialistPlugin (main.ts) — notices, ordering, async
// behavior and the documented late-resolving in-flight request behavior are
// byte-identical; main.ts is now only the composition root that instantiates
// this coordinator and delegates.
//
// Late in-flight resolutions are NOT cancelled: a request kicked off in one
// session that resolves after that session ends still writes into the
// (potentially cleared) context map and triggers a decoration sync. This is
// intentional — cancellation would require either propagating an
// AbortController through InquiryBriefResolver or generation-counting every
// request, and the existing harm (one extra sync per orphaned request) is
// strictly bounded by the number of segments that were ever rendered.
//
// The coordinator knows nothing about the plugin internals: the few
// collaborators it needs (panel refresh, decoration sync, opening the review
// panel, closing the settings modal) are reached through the narrow
// PendingEditsCoordinatorHost it is constructed with. It owns its own
// InquiryBriefResolver lifecycle via initialize().

import { Notice, TFile, type App } from "obsidian";
import { collectPendingEdits, describeCollectFailure } from "../core/PendingEditsCollector";
import {
	drainSegmentFromFrontmatter,
	extractInquiryBriefLinkTarget,
	formatPendingEditForDisplay,
	parsePendingEditsField,
	readPendingEditsField,
} from "../core/PendingEditsSegments";
import { InquiryBriefResolver, type InquiryBriefContext } from "../core/InquiryBriefContext";
import type { PendingEditSegment, PendingEditsSession } from "../models/PendingEditSegment";
import type { ToolbarState } from "../ui/Toolbar";

// Per-scene preview retained for the idle panel's expandable pending-edits
// block. `firstExcerpt` is a whitespace-collapsed, truncated snippet of the
// scene's first pending item — enough to recognize the edit at a glance.
export interface PendingEditsSceneSummary {
	scenePath: string;
	title: string;
	count: number;
	firstExcerpt: string;
}

export interface PendingEditsSummary {
	sceneCount: number;
	segmentCount: number;
	humanCount: number;
	inquiryCount: number;
	scenePaths: ReadonlySet<string>;
	segmentCountsByScene: ReadonlyMap<string, number>;
	scenes: ReadonlyArray<PendingEditsSceneSummary>;
}

const PENDING_EDIT_EXCERPT_MAX_LENGTH = 120;

function buildPendingEditExcerpt(text: string | undefined): string {
	if (!text) {
		return "";
	}
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= PENDING_EDIT_EXCERPT_MAX_LENGTH) {
		return collapsed;
	}
	return `${collapsed.slice(0, PENDING_EDIT_EXCERPT_MAX_LENGTH - 1).trimEnd()}…`;
}

export interface PendingEditsCoordinatorHost {
	readonly app: App;
	refreshReviewPanel(): void;
	syncActiveEditorDecorations(): void;
	openReviewPanel(): Promise<void>;
	closeSettingsModal(): void;
}

const PENDING_EDITS_SUMMARY_MIN_REFRESH_MS = 2000;

export class PendingEditsCoordinator {
	private pendingEditsSession: PendingEditsSession | null = null;
	private pendingEditsSummary: PendingEditsSummary | null = null;
	private pendingEditsSummaryInflight: Promise<void> | null = null;
	private pendingEditsSummaryLastRefreshAt = 0;
	private inquiryBriefResolver: InquiryBriefResolver | null = null;
	private inquiryBriefContextBySegmentId = new Map<string, InquiryBriefContext | null>();
	private inquiryBriefRequestsInflight = new Set<string>();

	constructor(private readonly host: PendingEditsCoordinatorHost) {}

	// Mirrors the onload step `this.inquiryBriefResolver = new InquiryBriefResolver(this.app)`.
	// Kept as an explicit lifecycle hook so the resolver stays null until the
	// plugin has loaded, exactly as before (the in-flight branch in
	// getOrFetchInquiryBriefContext is gated on a non-null resolver).
	initialize(): void {
		this.inquiryBriefResolver = new InquiryBriefResolver(this.host.app);
	}

	// Pass-1 leak fix: clear both inquiry maps on plugin teardown. Kept as a
	// dedicated method so onunload can call it without going through a session
	// close (which also re-syncs decorations).
	clearInquiryMaps(): void {
		this.inquiryBriefContextBySegmentId.clear();
		this.inquiryBriefRequestsInflight.clear();
	}

	getPendingEditsSession(): PendingEditsSession | null {
		return this.pendingEditsSession;
	}

	getPendingEditsSummary(): PendingEditsSummary | null {
		return this.pendingEditsSummary;
	}

	hasPendingEditsForScene(scenePath: string): boolean {
		return this.pendingEditsSummary?.scenePaths.has(scenePath) ?? false;
	}

	getPendingEditsCountForScene(scenePath: string): number {
		return this.pendingEditsSummary?.segmentCountsByScene.get(scenePath) ?? 0;
	}

	async refreshPendingEditsSummary(options?: { force?: boolean }): Promise<void> {
		const force = options?.force ?? false;
		const now = Date.now();
		if (!force && now - this.pendingEditsSummaryLastRefreshAt < PENDING_EDITS_SUMMARY_MIN_REFRESH_MS) {
			return this.pendingEditsSummaryInflight ?? Promise.resolve();
		}
		if (this.pendingEditsSummaryInflight) {
			return this.pendingEditsSummaryInflight;
		}

		const task = (async () => {
			try {
				const result = await collectPendingEdits(this.host.app);
				if (!result.ok) {
					this.pendingEditsSummary = null;
					return;
				}

				let humanCount = 0;
				let inquiryCount = 0;
				const scenePaths = new Set<string>();
				const segmentCountsByScene = new Map<string, number>();
				const scenes: PendingEditsSceneSummary[] = [];
				for (const scene of result.session.scenes) {
					scenePaths.add(scene.scenePath);
					segmentCountsByScene.set(scene.scenePath, scene.segments.length);
					for (const segment of scene.segments) {
						if (segment.kind === "human") humanCount += 1;
						else inquiryCount += 1;
					}
					scenes.push({
						scenePath: scene.scenePath,
						title: scene.sceneTitle,
						count: scene.segments.length,
						firstExcerpt: buildPendingEditExcerpt(scene.segments[0]?.text),
					});
				}

				this.pendingEditsSummary = {
					sceneCount: result.session.scenes.length,
					segmentCount: humanCount + inquiryCount,
					humanCount,
					inquiryCount,
					scenePaths,
					segmentCountsByScene,
					scenes,
				};
			} finally {
				this.pendingEditsSummaryLastRefreshAt = Date.now();
				this.pendingEditsSummaryInflight = null;
				this.host.refreshReviewPanel();
			}
		})();

		this.pendingEditsSummaryInflight = task;
		return task;
	}

	async startPendingEditsReview(): Promise<void> {
		// Drop any stale brief cache from a prior session BEFORE we touch the
		// new one. Without this, segment ids re-used across sessions would
		// see ghost context entries from the previous review. Runs even when
		// the collect below fails — entering "start a review" mode is itself
		// the signal that the previous session is over.
		this.clearInquiryMaps();

		const result = await collectPendingEdits(this.host.app);
		if (!result.ok) {
			new Notice(describeCollectFailure(result.reason));
			this.pendingEditsSession = null;
			return;
		}

		this.pendingEditsSession = result.session;
		const segmentCount = result.session.scenes.reduce(
			(total, scene) => total + scene.segments.length,
			0,
		);
		new Notice(
			`Pending edits: ${segmentCount} item${segmentCount === 1 ? "" : "s"} across ${result.session.scenes.length} scene${result.session.scenes.length === 1 ? "" : "s"}.`,
		);

		this.host.closeSettingsModal();
		await this.host.openReviewPanel();

		const firstSegment = result.session.scenes[0]?.segments[0] ?? null;
		if (firstSegment) {
			await this.openPendingEditSegment(firstSegment);
		}
	}

	// Scene-scoped variant of startPendingEditsReview: collects the active book
	// but narrows the session to a single scene so the reviewer can clear the
	// scene in front of them without iterating the whole book. The session shape
	// is identical (a `scenes` array), so navigation, the toolbar projection, and
	// complete/skip all work unchanged — there is just one scene to walk.
	async startPendingEditsReviewForScene(scenePath: string): Promise<void> {
		this.clearInquiryMaps();

		const result = await collectPendingEdits(this.host.app);
		if (!result.ok) {
			new Notice(describeCollectFailure(result.reason));
			this.pendingEditsSession = null;
			return;
		}

		const scene = result.session.scenes.find((candidate) => candidate.scenePath === scenePath);
		if (!scene || scene.segments.length === 0) {
			new Notice("No pending edits in this scene.");
			return;
		}

		this.pendingEditsSession = {
			...result.session,
			scenes: [scene],
			selectedSegmentId: scene.segments[0]?.id ?? null,
		};

		const count = scene.segments.length;
		new Notice(`Pending edits: ${count} item${count === 1 ? "" : "s"} in ${scene.sceneTitle}.`);

		this.host.closeSettingsModal();
		await this.host.openReviewPanel();

		const firstSegment = scene.segments[0] ?? null;
		if (firstSegment) {
			await this.openPendingEditSegment(firstSegment);
		}
	}

	async openPendingEditSegment(segment: PendingEditSegment): Promise<void> {
		const session = this.pendingEditsSession;
		if (!session) {
			return;
		}

		session.selectedSegmentId = segment.id;

		const file = this.host.app.vault.getAbstractFileByPath(segment.scenePath);
		if (!(file instanceof TFile)) {
			new Notice(`Scene file not found: ${segment.scenePath}`);
			return;
		}

		const activeFilePath = this.host.app.workspace.getActiveFile()?.path;
		if (activeFilePath !== segment.scenePath) {
			try {
				// Use a main-area leaf (not the side panel that getLeaf(false) can return after
				// the side-panel reveal) and explicitly activate it so getActiveViewOfType(MarkdownView)
				// returns the new view in syncActiveEditorDecorations.
				const leaf = this.host.app.workspace.getMostRecentLeaf() ?? this.host.app.workspace.getLeaf(false);
				await leaf.openFile(file, { active: true }); // SAFE: we hold a resolved TFile; activate so the markdown view becomes the active view of the workspace.
			} catch (error) {
				new Notice(`Couldn't open ${file.basename}: ${error instanceof Error ? error.message : "unknown error"}`);
				return;
			}
		}
		this.host.syncActiveEditorDecorations();
	}

	async completePendingEditSegment(segment: PendingEditSegment): Promise<void> {
		const file = this.host.app.vault.getAbstractFileByPath(segment.scenePath);
		if (!(file instanceof TFile)) {
			new Notice("Scene file no longer available.");
			return;
		}

		const drain = await drainSegmentFromFrontmatter(this.host.app, file, segment);
		if (drain.outcome === "not_found") {
			new Notice("This pending-edit item is no longer in the scene — skipping.");
		}

		this.rebuildPendingEditsSessionForScene(segment.scenePath);
		void this.refreshPendingEditsSummary({ force: true });
		await this.advanceToNextPendingEditSegment(segment);
	}

	async skipPendingEditSegment(segment: PendingEditSegment): Promise<void> {
		await this.advanceToNextPendingEditSegment(segment);
	}

	async completeSelectedPendingEditSegment(): Promise<void> {
		const segment = this.resolveActivePendingEditSegment();
		if (!segment) {
			return;
		}
		await this.completePendingEditSegment(segment);
	}

	async skipSelectedPendingEditSegment(): Promise<void> {
		const segment = this.resolveActivePendingEditSegment();
		if (!segment) {
			return;
		}
		await this.skipPendingEditSegment(segment);
	}

	async selectNextPendingEditSegment(): Promise<void> {
		const segment = this.resolveActivePendingEditSegment();
		if (!segment) {
			return;
		}
		await this.advancePendingEditSegmentBy(segment, "next");
	}

	async selectPreviousPendingEditSegment(): Promise<void> {
		const segment = this.resolveActivePendingEditSegment();
		if (!segment) {
			return;
		}
		await this.advancePendingEditSegmentBy(segment, "previous");
	}

	/**
	 * Source-of-truth resolver shared by the toolbar render and the action handlers.
	 * Returns whichever segment the toolbar is *currently displaying*, so Next/Prev/Complete
	 * always operate on what the user sees — even if `selectedSegmentId` is null/stale.
	 */
	private resolveActivePendingEditSegment(): PendingEditSegment | null {
		const session = this.pendingEditsSession;
		if (!session || session.scenes.length === 0) {
			return null;
		}
		const explicit = this.getSelectedPendingEditSegment();
		if (explicit) {
			return explicit;
		}
		const activeFilePath = this.host.app.workspace.getActiveFile()?.path;
		const sceneForActive = activeFilePath
			? session.scenes.find((scene) => scene.scenePath === activeFilePath)
			: undefined;
		return sceneForActive?.segments[0] ?? session.scenes[0]?.segments[0] ?? null;
	}

	async closePendingEditsReview(): Promise<void> {
		this.pendingEditsSession = null;
		this.inquiryBriefContextBySegmentId.clear();
		this.inquiryBriefRequestsInflight.clear();
		this.host.syncActiveEditorDecorations();
	}

	private getSelectedPendingEditSegment(): PendingEditSegment | null {
		const session = this.pendingEditsSession;
		if (!session || !session.selectedSegmentId) {
			return null;
		}

		for (const scene of session.scenes) {
			for (const segment of scene.segments) {
				if (segment.id === session.selectedSegmentId) {
					return segment;
				}
			}
		}
		return null;
	}

	private getOrderedPendingEditSegments(): PendingEditSegment[] {
		const session = this.pendingEditsSession;
		if (!session) {
			return [];
		}
		return session.scenes.flatMap((scene) => scene.segments);
	}

	getPendingEditsToolbarState(): ToolbarState | null {
		const session = this.pendingEditsSession;
		if (!session || session.scenes.length === 0) {
			return null;
		}

		const activeFilePath = this.host.app.workspace.getActiveFile()?.path;
		// If the user navigated to a file that is not part of the session, hide the toolbar.
		// During cross-scene Next, the active file may briefly lag the selected segment — that's fine,
		// as long as the active file is some scene in the session we keep showing the toolbar.
		if (activeFilePath && !session.scenes.some((scene) => scene.scenePath === activeFilePath)) {
			return null;
		}

		const segment = this.resolveActivePendingEditSegment();
		if (!segment) {
			return null;
		}

		const ordered = this.getOrderedPendingEditSegments();
		const currentIndex = ordered.findIndex((candidate) => candidate.id === segment.id);
		const segmentIndexLabel =
			currentIndex === -1
				? `${ordered.length} total`
				: `Item ${currentIndex + 1} of ${ordered.length}`;
		const segmentKindLabel = segment.kind === "human" ? "HUMAN NOTE" : "INQUIRY ITEM";
		const display = formatPendingEditForDisplay(segment);
		const briefContext = this.getOrFetchInquiryBriefContext(segment);

		return {
			mode: "pending_edits_review",
			title: "Pending edits",
			sceneLabel: segment.sceneTitle,
			segmentKindLabel,
			segmentIndexLabel,
			segmentMutedPrefix: display.mutedPrefix,
			segmentActionText: display.actionText,
			briefContext: briefContext
				? {
					noteTitle: briefContext.noteTitle,
					notePath: briefContext.notePath,
					summary: briefContext.summary,
				}
				: undefined,
			canComplete: true,
			canNext: currentIndex !== -1 && currentIndex < ordered.length - 1,
			canPrevious: currentIndex > 0,
		};
	}

	private getOrFetchInquiryBriefContext(segment: PendingEditSegment): InquiryBriefContext | null {
		if (segment.kind !== "inquiry") {
			return null;
		}
		const linkTarget = extractInquiryBriefLinkTarget(segment);
		if (!linkTarget) {
			return null;
		}
		if (this.inquiryBriefContextBySegmentId.has(segment.id)) {
			return this.inquiryBriefContextBySegmentId.get(segment.id) ?? null;
		}
		if (!this.inquiryBriefRequestsInflight.has(segment.id) && this.inquiryBriefResolver) {
			this.inquiryBriefRequestsInflight.add(segment.id);
			void this.inquiryBriefResolver
				.resolve(linkTarget, segment.scenePath)
				.then((context) => {
					this.inquiryBriefContextBySegmentId.set(segment.id, context);
					this.inquiryBriefRequestsInflight.delete(segment.id);
					this.host.syncActiveEditorDecorations();
				})
				.catch(() => {
					this.inquiryBriefContextBySegmentId.set(segment.id, null);
					this.inquiryBriefRequestsInflight.delete(segment.id);
				});
		}
		return null;
	}

	openInquiryBriefNote(notePath: string): void {
		void this.host.app.workspace.openLinkText(notePath, "", false);
	}

	private async advancePendingEditSegmentBy(
		fromSegment: PendingEditSegment,
		direction: "next" | "previous",
	): Promise<void> {
		const ordered = this.getOrderedPendingEditSegments();
		if (ordered.length === 0) {
			return;
		}

		const currentIndex = ordered.findIndex((candidate) => candidate.id === fromSegment.id);
		if (currentIndex === -1) {
			return;
		}

		const targetIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
		if (targetIndex < 0 || targetIndex >= ordered.length) {
			return;
		}

		const target = ordered[targetIndex];
		if (!target) {
			return;
		}
		await this.openPendingEditSegment(target);
	}

	private rebuildPendingEditsSessionForScene(scenePath: string): void {
		const session = this.pendingEditsSession;
		if (!session) {
			return;
		}

		const file = this.host.app.vault.getAbstractFileByPath(scenePath);
		if (!(file instanceof TFile)) {
			session.scenes = session.scenes.filter((scene) => scene.scenePath !== scenePath);
			return;
		}

		const rawField = readPendingEditsField(this.host.app, file);
		const existing = session.scenes.find((scene) => scene.scenePath === scenePath);
		const segments = parsePendingEditsField(
			scenePath,
			existing?.sceneTitle ?? file.basename,
			existing?.sceneOrder ?? 0,
			rawField,
		);

		if (segments.length === 0) {
			session.scenes = session.scenes.filter((scene) => scene.scenePath !== scenePath);
			return;
		}

		session.scenes = session.scenes.map((scene) =>
			scene.scenePath === scenePath
				? { ...scene, rawField, segments }
				: scene,
		);
	}

	private async advanceToNextPendingEditSegment(fromSegment: PendingEditSegment): Promise<void> {
		const session = this.pendingEditsSession;
		if (!session) {
			return;
		}

		const ordered: PendingEditSegment[] = session.scenes.flatMap((scene) => scene.segments);
		if (ordered.length === 0) {
			new Notice("All pending edits processed.");
			this.pendingEditsSession = null;
			return;
		}

		const unchangedIndex = ordered.findIndex((candidate) => candidate.id === fromSegment.id);
		const nextSegment = unchangedIndex >= 0
			? ordered[unchangedIndex + 1] ?? ordered[0]
			: ordered[0];

		if (!nextSegment) {
			new Notice("All pending edits processed.");
			this.pendingEditsSession = null;
			return;
		}

		await this.openPendingEditSegment(nextSegment);
	}
}
