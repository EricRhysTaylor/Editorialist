import type { EditorView } from "@codemirror/view";
import { MarkdownView, normalizePath, Notice, Plugin, TFile, type App } from "obsidian";
import {
	collectPendingEdits,
	describeCollectFailure,
} from "./core/PendingEditsCollector";
import {
	drainSegmentFromFrontmatter,
	extractInquiryBriefLinkTarget,
	formatPendingEditForDisplay,
	parsePendingEditsField,
	readPendingEditsField,
} from "./core/PendingEditsSegments";
import { InquiryBriefResolver, type InquiryBriefContext } from "./core/InquiryBriefContext";
import type {
	PendingEditSegment,
	PendingEditsSession,
} from "./models/PendingEditSegment";
import { registerCommands } from "./commands/Commands";
import { deriveContributorIdentitySeed } from "./core/ContributorIdentity";
import { ImportEngine } from "./core/ImportEngine";
import { MatchEngine } from "./core/MatchEngine";
import {
	canApplySuggestionDirectly,
	createSuggestionApplyPlan,
	getEffectiveSuggestionStatus as getEffectiveSuggestionStatusShared,
	getSuggestionAnchorTarget,
	getSuggestionPresentationTone,
	getSuggestionPrimaryTarget,
	getSuggestionStatusRank,
	isImplicitlyAcceptedCutSuggestion as isImplicitlyAcceptedCutSuggestionShared,
	isSuggestionOpen as isSuggestionOpenShared,
} from "./core/OperationSupport";
import {
	REVIEW_BLOCK_FENCE,
	getReviewBlockFenceLabel,
	normalizeImportedReviewText,
	noteContainsReviewBlock,
	removeImportedReviewBlocks,
} from "./core/ReviewBlockFormat";
import { ReviewEngine } from "./core/ReviewEngine";
import { buildReviewTemplate } from "./core/ReviewTemplate";
import { SuggestionParser } from "./core/SuggestionParser";
import type {
	EditorialistMetadataExport,
	ReviewImportBatch,
	ReviewSweepRegistryEntry,
} from "./models/ReviewImport";
import type { ReviewSession, ReviewSuggestion, ReviewTargetRef } from "./models/ReviewSuggestion";
import type {
	EditorialistPluginData,
	ParsedReviewerReference,
	ReviewerProfile,
	ReviewerResolutionStatus,
	SceneReviewRecord,
	ReviewerStats,
} from "./models/ReviewerProfile";
import { ReviewStore, type AppliedReviewChange, type AppliedReviewState, type CompletedSweepState, type GuidedSweepState } from "./state/ReviewStore";
import { ReviewerDirectory } from "./state/ReviewerDirectory";
import { ReviewRegistryService } from "./services/ReviewRegistryService";
import { ReviewWorkflowService } from "./services/ReviewWorkflowService";
import { EditorialistModal, type ClipboardReviewBatch } from "./ui/EditorialistModal";
import { openEditorialistChoiceModal } from "./ui/EditorialistChoiceModal";
import { openContributorReassignmentModal, type ContributorReassignmentMode } from "./ui/ContributorReassignmentModal";
import { openContributorStrengthsModal } from "./ui/ContributorStrengthsModal";
import { REVIEW_PANEL_VIEW_TYPE, ReviewPanel } from "./ui/ReviewPanel";
import { EditorialistSettingTab } from "./ui/EditorialistSettingTab";
import { createReviewDecorationsExtension, syncReviewDecorations } from "./ui/Decorations";
import { createReviewToolbarElement, forceTeardownToolbarSubscriptions, type ToolbarState } from "./ui/Toolbar";

interface ActiveNoteContext {
	filePath: string;
	text: string;
	view: MarkdownView;
}

interface OffsetRange {
	end: number;
	start: number;
}

type HighlightTone = "active" | "muted" | "anchor";

interface LastAppliedChange {
	end: number;
	notePath: string;
	start: number;
	suggestionId: string;
	textFingerprint: string;
}

interface GuidedSweepHandoffState {
	currentLabel: string;
	currentPath: string;
	isFinal: boolean;
	nextLabel?: string;
	nextPath?: string;
	primaryActionLabel: string;
	progressLabel: string;
	panelProgressLabel: string;
	secondaryActionLabel?: string;
	summary: string;
	title: string;
	unitLabel: "note" | "scene";
}

interface EditorialistLaunchState {
	currentNoteHasReviewBlock: boolean;
	currentNoteStatus?: "ready" | "completed";
	nextNoteLabel?: string;
	nextNotePath?: string;
	noteUnitLabel: "note" | "scene";
}

interface PanelOnlyReviewState {
	contextLabel?: string;
	description: string;
	progressLabel?: string;
	remainingCount: number;
	title: string;
	unitLabel: "note" | "scene";
}

interface AcceptedReviewPreviewState {
	currentIndexLabel: string;
	title: string;
}

interface CompletedReviewPreviewState {
	currentIndexLabel?: string;
	title: string;
}

interface CompletedSweepPanelState {
	closeLabel: string;
	description: string;
	editsReviewedLabel: string;
	durationLabel?: string;
	nextSteps: Array<{
		action?: "clean" | "import" | "start";
		label: string;
	}>;
	title: string;
}

interface PostCompletionIdleState {
	description: string;
	title: string;
}

interface BulkApplyConfirmState {
	notePath: string;
}

interface ReviewLaunchTarget {
	intent: "active" | "next";
	label: string;
	notePath: string;
	unitLabel: "note" | "scene";
}

export interface PendingEditsSummary {
	sceneCount: number;
	segmentCount: number;
	humanCount: number;
	inquiryCount: number;
	scenePaths: ReadonlySet<string>;
	segmentCountsByScene: ReadonlyMap<string, number>;
}

const PENDING_EDITS_SUMMARY_MIN_REFRESH_MS = 2000;

export default class EditorialistPlugin extends Plugin {
	readonly store = new ReviewStore();

	private readonly reviewerDirectory = new ReviewerDirectory();
	private readonly parser = new SuggestionParser(this.reviewerDirectory);
	private readonly matchEngine = new MatchEngine();
	private readonly reviewEngine = new ReviewEngine(this.parser, this.matchEngine);
	private readonly registry = new ReviewRegistryService(
		this.app,
		this.reviewEngine,
		this.reviewerDirectory,
		() => this.savePluginData(),
	);
	private readonly workflow = new ReviewWorkflowService(this.store, this.registry, {
		clearReviewSelection: async () => {
			this.store.selectSuggestion(null);
			await this.revealSelectedSuggestion();
		},
		cleanupBatchById: async (batchId) => {
			await this.cleanupReviewBatch(batchId);
		},
		enterCompletedSweepAudit: async () => {
			await this.enterCompletedSweepAudit();
		},
		notify: (message) => {
			new Notice(message);
		},
		openNoteForReview: async (filePath) => {
			await this.startOrResumeReviewForNote(filePath);
			this.syncActiveEditorDecorations();
		},
		recordCompletedSceneRevision: async (notePath, batchId) => {
			return this.recordCompletedSceneRevision(notePath, batchId);
		},
	});
	private importEngine!: ImportEngine;

	private activeHighlightRange: OffsetRange | null = null;
	private activeHighlightTone: HighlightTone = "active";
	private activeAnchorHighlightRange: OffsetRange | null = null;
	private bulkApplyConfirmState: BulkApplyConfirmState | null = null;
	private lastAppliedChange: LastAppliedChange | null = null;
	private toolbarOverlayEl: HTMLElement | null = null;
	private toolbarOverlayEditorView: EditorView | null = null;
	private toolbarOverlayFrameId: number | null = null;
	private toolbarOverlayHeight = 0;
	private toolbarOverlayLastPosition: { hidden: boolean; left: string; top: string } | null = null;
	private toolbarOverlayState: ToolbarState | null = null;
	private toolbarOverlayDismissedSignature: string | null = null;
	private pendingEditsSession: PendingEditsSession | null = null;
	private pendingEditsSummary: PendingEditsSummary | null = null;
	private pendingEditsSummaryInflight: Promise<void> | null = null;
	private pendingEditsSummaryLastRefreshAt = 0;
	private inquiryBriefResolver: InquiryBriefResolver | null = null;
	private inquiryBriefContextBySegmentId = new Map<string, InquiryBriefContext | null>();
	private inquiryBriefRequestsInflight = new Set<string>();
	private readonly toolbarOverlayScrollHandler = (): void => {
		this.scheduleToolbarOverlayPositionUpdate();
	};

	async onload(): Promise<void> {
		await this.loadPluginData();
		await this.persistContributorProfilesIfNeeded();
		await this.registry.refreshActiveBookScope();
		this.importEngine = new ImportEngine(this.app, this.parser, this.matchEngine);
		this.inquiryBriefResolver = new InquiryBriefResolver(this.app);
		this.registerEditorExtension(createReviewDecorationsExtension());
		this.registerView(REVIEW_PANEL_VIEW_TYPE, (leaf) => new ReviewPanel(leaf, this));
		this.addSettingTab(new EditorialistSettingTab(this.app, this));
		this.addRibbonIcon("pen-tool", "Open review panel", () => {
			void this.openReviewPanel();
		});
		registerCommands(this);
		this.registerDomEvent(window, "resize", () => {
			this.measureToolbarOverlayHeight();
			this.scheduleToolbarOverlayPositionUpdate();
		});

		const unsubscribe = this.store.subscribe(() => {
			this.refreshReviewPanel();
			this.syncActiveEditorDecorations();
		});
		this.register(unsubscribe);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.workflow.isTransitioning()) {
					return;
				}
				this.resyncSessionForActiveNote();
				this.syncActiveEditorDecorations();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				if (this.workflow.isTransitioning()) {
					return;
				}
				this.resyncSessionForActiveNote();
				this.syncActiveEditorDecorations();
				void this.refreshPendingEditsSummary();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				this.resyncSessionForActiveNote();
			}),
		);

		this.syncActiveEditorDecorations();
		void this.refreshPendingEditsSummary({ force: true });
	}

	async onunload(): Promise<void> {
		// Obsidian submission guideline: do NOT detach leaves of your own view type here —
		// Obsidian restores workspace state on reload, and registerView() already handles cleanup.
		this.destroyToolbarOverlay();
		forceTeardownToolbarSubscriptions();
	}

	async parseCurrentNote(options?: { suppressNotice?: boolean }): Promise<void> {
		const suppressNotice = options?.suppressNotice ?? false;
		const context = this.getActiveNoteContext();
		if (!context) {
			if (!suppressNotice) {
				new Notice("No active markdown note to review.");
			}
			return;
		}

		await this.parseReviewContext(context, suppressNotice);
	}

	private async parseReviewContext(
		context: ActiveNoteContext,
		suppressNotice: boolean,
	): Promise<void> {
		const previousSession = this.store.getSession();
		const preferredSelectionId =
			previousSession?.notePath === context.filePath ? this.store.getState().selectedSuggestionId : null;
		const session = this.reviewEngine.buildSession(
			context.filePath,
			context.text,
			previousSession?.notePath === context.filePath ? previousSession : null,
		);
		const hydratedSession = this.registry.applyPersistedReviewState(session);
		await this.persistContributorProfilesIfNeeded();

		if (!hydratedSession.hasReviewBlock) {
			this.clearActiveHighlights();
			this.lastAppliedChange = null;
			this.store.clearSession();
			if (!suppressNotice) {
				new Notice(`No ${getReviewBlockFenceLabel()} found in this note.`);
			}
			return;
		}

		this.store.setSession(hydratedSession, preferredSelectionId);
		this.syncSelectionForSession(hydratedSession, preferredSelectionId);
		await this.workflow.syncCurrentNote(context.filePath);
		await this.registry.syncReviewerSignalsForSession(hydratedSession, {
			...this.getCurrentSessionTrackingContext(),
		});
		await this.openReviewPanel();
		await this.revealSelectedSuggestion();
		if (!suppressNotice) {
			new Notice(
				hydratedSession.suggestions.length > 0
					? `Parsed ${hydratedSession.suggestions.length} review suggestion${hydratedSession.suggestions.length === 1 ? "" : "s"}.`
					: "Review block found, but no valid review entries were parsed.",
			);
		}
	}

	async openPrepareReviewFormatModal(): Promise<void> {
		await this.openEditorialistModal();
	}

	async openImportReviewBatchModal(): Promise<void> {
		await this.openEditorialistModal();
	}

	async openEditorialistModal(): Promise<void> {
		const context = this.getActiveNoteContext();
		const selectedText = this.getActiveEditorSelection();
		const launchState = this.getEditorialistLaunchState(context);
		new EditorialistModal(this.app, {
			activeNoteLabel: context?.view.file?.basename,
			currentNoteHasReviewBlock: launchState.currentNoteHasReviewBlock,
			currentNoteStatus: launchState.currentNoteStatus,
			isReviewPanelOpen: this.isReviewPanelOpen(),
			nextNoteLabel: launchState.nextNoteLabel,
			noteUnitLabel: launchState.noteUnitLabel,
			onCopyTemplate: async () => {
				await this.copyReviewTemplateToClipboard(selectedText);
			},
			onImportBatch: async (batch, startReview) => {
				await this.importReviewBatch(batch, startReview);
			},
			onImportRawToActiveNote: async (rawText, startReview) => {
				await this.importReviewBatchToActiveNote(rawText, startReview);
			},
			onInspectBatch: async (rawText) =>
				this.inspectReviewBatch(rawText, { activeNotePath: context?.filePath }),
			onLoadClipboardBatch: async () => this.loadClipboardReviewBatch(),
			onOpenReviewPanel: async () => {
				await this.openReviewPanel();
			},
			onStartReviewInCurrentNote: async () => {
				await this.parseCurrentNote({ suppressNotice: true });
			},
			onStartReviewInNextNote: async () => {
				await this.openNextSweepNoteFromLaunch();
			},
		}).open();
	}

	async openReviewPanel(): Promise<void> {
		const existingLeaves = this.app.workspace.getLeavesOfType(REVIEW_PANEL_VIEW_TYPE);
		const [primaryLeaf, ...duplicateLeaves] = existingLeaves;
		for (const duplicateLeaf of duplicateLeaves) {
			duplicateLeaf.detach();
		}

		const leaf = primaryLeaf ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}

		await leaf.setViewState({
			type: REVIEW_PANEL_VIEW_TYPE,
			active: false,
		});
		this.app.workspace.revealLeaf(leaf);
		this.refreshReviewPanel();
		void this.refreshPendingEditsSummary({ force: true });
	}

	isReviewPanelOpen(): boolean {
		return this.app.workspace.getLeavesOfType(REVIEW_PANEL_VIEW_TYPE).length > 0;
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
				const result = await collectPendingEdits(this.app);
				if (!result.ok) {
					this.pendingEditsSummary = null;
					return;
				}

				let humanCount = 0;
				let inquiryCount = 0;
				const scenePaths = new Set<string>();
				const segmentCountsByScene = new Map<string, number>();
				for (const scene of result.session.scenes) {
					scenePaths.add(scene.scenePath);
					segmentCountsByScene.set(scene.scenePath, scene.segments.length);
					for (const segment of scene.segments) {
						if (segment.kind === "human") humanCount += 1;
						else inquiryCount += 1;
					}
				}

				this.pendingEditsSummary = {
					sceneCount: result.session.scenes.length,
					segmentCount: humanCount + inquiryCount,
					humanCount,
					inquiryCount,
					scenePaths,
					segmentCountsByScene,
				};
			} finally {
				this.pendingEditsSummaryLastRefreshAt = Date.now();
				this.pendingEditsSummaryInflight = null;
				this.refreshReviewPanel();
			}
		})();

		this.pendingEditsSummaryInflight = task;
		return task;
	}

	async startPendingEditsReview(): Promise<void> {
		const result = await collectPendingEdits(this.app);
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

		this.closeSettingsModal();
		await this.openReviewPanel();

		const firstSegment = result.session.scenes[0]?.segments[0] ?? null;
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

		const file = this.app.vault.getAbstractFileByPath(segment.scenePath);
		if (!(file instanceof TFile)) {
			new Notice(`Scene file not found: ${segment.scenePath}`);
			return;
		}

		const activeFilePath = this.app.workspace.getActiveFile()?.path;
		if (activeFilePath !== segment.scenePath) {
			try {
				// Use a main-area leaf (not the side panel that getLeaf(false) can return after
				// the side-panel reveal) and explicitly activate it so getActiveViewOfType(MarkdownView)
				// returns the new view in syncActiveEditorDecorations.
				const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);
				await leaf.openFile(file, { active: true }); // SAFE: we hold a resolved TFile; activate so the markdown view becomes the active view of the workspace.
			} catch (error) {
				new Notice(`Couldn't open ${file.basename}: ${error instanceof Error ? error.message : "unknown error"}`);
				return;
			}
		}
		this.syncActiveEditorDecorations();
	}

	async completePendingEditSegment(segment: PendingEditSegment): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(segment.scenePath);
		if (!(file instanceof TFile)) {
			new Notice("Scene file no longer available.");
			return;
		}

		const drain = await drainSegmentFromFrontmatter(this.app, file, segment);
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
		const activeFilePath = this.app.workspace.getActiveFile()?.path;
		const sceneForActive = activeFilePath
			? session.scenes.find((scene) => scene.scenePath === activeFilePath)
			: undefined;
		return sceneForActive?.segments[0] ?? session.scenes[0]?.segments[0] ?? null;
	}

	async closePendingEditsReview(): Promise<void> {
		this.pendingEditsSession = null;
		this.syncActiveEditorDecorations();
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

	private getPendingEditsToolbarState(): ToolbarState | null {
		const session = this.pendingEditsSession;
		if (!session || session.scenes.length === 0) {
			return null;
		}

		const activeFilePath = this.app.workspace.getActiveFile()?.path;
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
					this.syncActiveEditorDecorations();
				})
				.catch(() => {
					this.inquiryBriefContextBySegmentId.set(segment.id, null);
					this.inquiryBriefRequestsInflight.delete(segment.id);
				});
		}
		return null;
	}

	openInquiryBriefNote(notePath: string): void {
		void this.app.workspace.openLinkText(notePath, "", false);
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

		const file = this.app.vault.getAbstractFileByPath(scenePath);
		if (!(file instanceof TFile)) {
			session.scenes = session.scenes.filter((scene) => scene.scenePath !== scenePath);
			return;
		}

		const rawField = readPendingEditsField(this.app, file);
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

	openSettings(): void {
		const appWithSettings = this.app as App & {
			setting?: {
				open: () => void;
				openTabById?: (id: string) => void;
			};
		};

		appWithSettings.setting?.open();
		appWithSettings.setting?.openTabById?.(this.manifest.id);
	}

	private closeSettingsModal(): void {
		const appWithSettings = this.app as App & {
			setting?: {
				close?: () => void;
			};
		};
		appWithSettings.setting?.close?.();
	}

	async selectSuggestion(id: string): Promise<void> {
		if (!this.hasReviewSessionContext()) {
			return;
		}

		this.bulkApplyConfirmState = null;
		this.syncAppliedReviewSelection(id);
		this.store.selectSuggestion(id);
		await this.revealSuggestionContext(id);
	}

	async selectNextSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const nextSuggestionId = this.getAdjacentRevealableSuggestionId("next");
		if (!nextSuggestionId) {
			await this.workflow.advanceGuidedSweep();
			return;
		}

		this.store.selectSuggestion(nextSuggestionId);
		await this.revealSelectedSuggestion();
	}

	async selectPreviousSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const previousSuggestionId = this.getAdjacentRevealableSuggestionId("previous");
		if (!previousSuggestionId) {
			return;
		}

		this.store.selectSuggestion(previousSuggestionId);
		await this.revealSelectedSuggestion();
	}

	async selectNextAcceptedSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const nextSuggestionId = this.getAdjacentAcceptedSuggestionId("next");
		if (!nextSuggestionId) {
			return;
		}

		this.store.selectSuggestion(nextSuggestionId);
		await this.revealSelectedSuggestion();
	}

	async selectPreviousAcceptedSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const previousSuggestionId = this.getAdjacentAcceptedSuggestionId("previous");
		if (!previousSuggestionId) {
			return;
		}

		this.store.selectSuggestion(previousSuggestionId);
		await this.revealSelectedSuggestion();
	}

	async exitAcceptedReviewMode(): Promise<void> {
		const session = this.getReviewSession();
		if (!session) {
			return;
		}

		const nextSuggestionId = this.findPreferredSuggestionId(session.suggestions);
		this.store.selectSuggestion(nextSuggestionId);
		await this.revealSelectedSuggestion();
	}

	async acceptSelectedSuggestion(): Promise<boolean> {
		if (!this.hasActiveReviewSession()) {
			return false;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return false;
		}

		return this.acceptSuggestion(selectedSuggestion.id);
	}

	async acceptSelectedSuggestionAndAdvance(): Promise<void> {
		if (!(await this.acceptSelectedSuggestion())) {
			return;
		}

		await this.selectNextSuggestion();
	}

	async enterApplyAndReviewConfirmMode(): Promise<void> {
		const session = this.getReviewSession();
		if (!session) {
			return;
		}

		if (!this.canApplyAndReviewSceneSuggestions()) {
			new Notice("No eligible suggestions are ready to apply and review in this scene.");
			return;
		}

		this.bulkApplyConfirmState = { notePath: session.notePath };
		this.syncActiveEditorDecorations();
	}

	cancelApplyAndReviewConfirmMode(): void {
		if (!this.bulkApplyConfirmState) {
			return;
		}

		this.bulkApplyConfirmState = null;
		this.syncActiveEditorDecorations();
	}

	async confirmApplyAndReviewSceneSuggestions(): Promise<void> {
		this.bulkApplyConfirmState = null;
		await this.applyAndReviewSceneSuggestions();
	}

	async applyAndReviewSceneSuggestions(): Promise<void> {
		const context = this.getReviewNoteContext();
		const session = this.getReviewSession();
		if (!context || !session || session.notePath !== context.filePath) {
			new Notice("The active note does not match the current review session.");
			return;
		}

		const candidateIds = session.suggestions
			.filter((suggestion) => this.canApplySuggestionInReviewAllMode(suggestion))
			.map((suggestion) => suggestion.id);
		if (candidateIds.length === 0) {
			new Notice("No eligible suggestions are ready to apply and review in this scene.");
			return;
		}

		const appliedChanges: AppliedReviewChange[] = [];
		for (const suggestionId of candidateIds) {
			const appliedChange = await this.applySuggestionById(suggestionId, {
				highlightMode: "none",
				preserveSelection: true,
				syncSceneInventory: false,
			});
			if (appliedChange) {
				appliedChanges.push(appliedChange);
			}
		}

		if (appliedChanges.length === 0) {
			new Notice("No eligible suggestions could be safely applied.");
			return;
		}

		await this.registry.syncSceneInventory();
		await this.enterAppliedReviewMode(appliedChanges);
		new Notice(
			`Applied and queued ${appliedChanges.length} change${appliedChanges.length === 1 ? "" : "s"} for review.`,
		);
	}

	async selectNextAppliedReviewChange(): Promise<void> {
		const appliedReview = this.store.getAppliedReview();
		if (!appliedReview || appliedReview.entries.length === 0) {
			return;
		}

		const nextIndex = (appliedReview.currentIndex + 1) % appliedReview.entries.length;
		await this.focusAppliedReviewEntry(nextIndex);
	}

	async selectPreviousAppliedReviewChange(): Promise<void> {
		const appliedReview = this.store.getAppliedReview();
		if (!appliedReview || appliedReview.entries.length === 0) {
			return;
		}

		const previousIndex =
			(appliedReview.currentIndex - 1 + appliedReview.entries.length) % appliedReview.entries.length;
		await this.focusAppliedReviewEntry(previousIndex);
	}

	async exitAppliedReviewMode(): Promise<void> {
		if (!this.store.getAppliedReview()) {
			return;
		}

		this.bulkApplyConfirmState = null;
		this.store.setAppliedReview(null);
		this.setDefaultHighlightForSelection();
		this.syncActiveEditorDecorations();
	}

	async closeActiveReviewContext(): Promise<void> {
		const completedSweep = this.getResolvedCompletedSweepState();
		this.bulkApplyConfirmState = null;
		this.store.setAppliedReview(null);
		this.store.setCompletedSweep(null);
		this.store.clearSession();
		this.store.acknowledgeCompletedSweep(completedSweep?.batchId ?? this.store.getAcknowledgedCompletedSweepBatchId());
		this.clearActiveHighlights();
		this.lastAppliedChange = null;
		this.toolbarOverlayDismissedSignature = null;
		this.syncActiveEditorDecorations();
	}

	async closeReviewPanel(): Promise<void> {
		await this.closeActiveReviewContext();
		this.app.workspace.detachLeavesOfType(REVIEW_PANEL_VIEW_TYPE);
	}

	dismissReviewToolbar(): void {
		this.toolbarOverlayDismissedSignature = this.computeToolbarDismissalSignature(
			this.toolbarOverlayState,
		);
		this.destroyToolbarOverlay();
	}

	private computeToolbarDismissalSignature(state: ToolbarState | null): string {
		const mode = state?.mode ?? "none";
		const selectionId = this.store.getState().selectedSuggestionId ?? "";
		return `${mode}:${selectionId}`;
	}

	async continueGuidedSweep(): Promise<void> {
		await this.workflow.advanceGuidedSweep();
	}

	async finishGuidedSweep(): Promise<void> {
		await this.workflow.finishGuidedSweep();
	}

	async recordCompletedSceneRevision(
		notePath: string,
		batchId: string,
	): Promise<{ from: number; to: number } | null> {
		const session = this.getReviewSession();
		if (session?.notePath === notePath && !this.isSweepComplete(session.suggestions)) {
			return null;
		}

		return this.registry.incrementSceneEditorialRevision(notePath, batchId);
	}

	async resumeCompletedReviewMode(): Promise<void> {
		const completedSweep = this.getResolvedCompletedSweepState();
		if (!completedSweep) {
			return;
		}

		if (!this.store.getCompletedSweep()) {
			this.store.setCompletedSweep(completedSweep);
		}

		await this.enterCompletedSweepAudit();
	}

	async selectNextCompletedReviewSuggestion(): Promise<void> {
		const nextId = this.getAdjacentCompletedReviewSuggestionId("next");
		if (!nextId) {
			return;
		}

		this.store.selectSuggestion(nextId);
		await this.revealSelectedSuggestion();
	}

	async selectPreviousCompletedReviewSuggestion(): Promise<void> {
		const previousId = this.getAdjacentCompletedReviewSuggestionId("previous");
		if (!previousId) {
			return;
		}

		this.store.selectSuggestion(previousId);
		await this.revealSelectedSuggestion();
	}

	async exitCompletedReviewMode(): Promise<void> {
		this.store.setCompletedSweep(null);
		this.store.clearSession();
		this.clearActiveHighlights();
		this.syncActiveEditorDecorations();
	}

	async rejectSelectedSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.rejectSuggestion(selectedSuggestion.id);
	}

	async rewriteSelectedSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.markSuggestionRewritten(selectedSuggestion.id);
	}

	deferSelectedSuggestion(): void {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		void this.deferSuggestion(selectedSuggestion.id);
	}

	async jumpToSelectedSuggestionTarget(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.jumpToSuggestionTarget(selectedSuggestion.id);
	}

	async jumpToSelectedSuggestionAnchor(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.jumpToSuggestionAnchor(selectedSuggestion.id);
	}

	async jumpToSelectedSuggestionSource(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.jumpToSuggestionSource(selectedSuggestion.id);
	}

	async acceptSuggestion(id: string): Promise<boolean> {
		const acceptedSuggestion = this.getSuggestionById(id);
		const appliedChange = await this.applySuggestionById(id, {
			highlightMode: "muted",
		});
		if (!appliedChange) {
			return false;
		}

		const refreshedSession = this.store.getSession();
		if (this.shouldShowGuidedSweepHandoff(refreshedSession)) {
			await this.enterGuidedSweepHandoff();
			return true;
		}

		const nextSuggestionId = this.getAdjacentRevealableSuggestionId("next", id);
		if (this.getPanelOnlyReviewStateForSession(refreshedSession) && nextSuggestionId) {
			this.store.selectSuggestion(nextSuggestionId);
			await this.revealSelectedSuggestion();
			return true;
		}

		if (acceptedSuggestion?.operation === "cut" && nextSuggestionId) {
			this.store.selectSuggestion(nextSuggestionId);
			await this.revealSelectedSuggestion();
			return true;
		}

		if (acceptedSuggestion?.operation === "move") {
			this.store.selectSuggestion(id);
			await this.revealSelectedSuggestion();
			return true;
		}

		const hasHighlightableRange = appliedChange.end > appliedChange.start;
		if (!hasHighlightableRange && nextSuggestionId) {
			this.store.selectSuggestion(nextSuggestionId);
			await this.revealSelectedSuggestion();
			return true;
		}

		this.store.selectSuggestion(id);
		return true;
	}

	async rejectSuggestion(id: string): Promise<void> {
		if (!this.canRejectSuggestion(id)) {
			return;
		}

		const session = this.getReviewSession();
		const suggestion = this.getSuggestionById(id);
		const { sessionId, sessionStartedAt } = this.getCurrentSessionTrackingContext();
		if (session && suggestion) {
			await this.registry.persistReviewDecision(session.notePath, suggestion, "rejected", {
				persist: false,
				sessionId,
				sessionStartedAt,
			});
		}

		const nextSuggestionId = this.getAdjacentRevealableSuggestionId("next", id);
		this.store.updateSuggestionStatus(id, "rejected");
		await this.registry.syncReviewerSignalsForSession(this.store.getSession(), {
			persist: false,
			sessionId,
			sessionStartedAt,
		});
		await this.registry.syncSceneInventoryForSession(this.store.getSession());
		if (nextSuggestionId) {
			this.store.selectSuggestion(nextSuggestionId);
			await this.revealSelectedSuggestion();
			return;
		}

		if (this.shouldShowGuidedSweepHandoff(this.store.getSession())) {
			await this.enterGuidedSweepHandoff();
		}
	}

	async markSuggestionRewritten(id: string): Promise<void> {
		if (!this.canMarkSuggestionRewritten(id)) {
			return;
		}

		const session = this.getReviewSession();
		const suggestion = this.getSuggestionById(id);
		const { sessionId, sessionStartedAt } = this.getCurrentSessionTrackingContext();
		if (session && suggestion) {
			await this.registry.persistReviewDecision(session.notePath, suggestion, "rewritten", {
				persist: false,
				sessionId,
				sessionStartedAt,
			});
		}

		const nextSuggestionId = this.getAdjacentRevealableSuggestionId("next", id);
		this.store.updateSuggestionStatus(id, "rewritten");
		await this.registry.syncReviewerSignalsForSession(this.store.getSession(), {
			persist: false,
			sessionId,
			sessionStartedAt,
		});
		await this.registry.syncSceneInventoryForSession(this.store.getSession());
		if (nextSuggestionId) {
			this.store.selectSuggestion(nextSuggestionId);
			await this.revealSelectedSuggestion();
			return;
		}

		if (this.shouldShowGuidedSweepHandoff(this.store.getSession())) {
			await this.enterGuidedSweepHandoff();
			return;
		}

		this.store.selectSuggestion(this.findPreferredSuggestionId(this.store.getSession()?.suggestions ?? []));
		await this.revealSelectedSuggestion();
	}

	private async applySuggestionById(
		id: string,
		options?: {
			highlightMode?: "muted" | "none";
			preserveSelection?: boolean;
			syncSceneInventory?: boolean;
		},
	): Promise<AppliedReviewChange | null> {
		const context = this.getReviewNoteContext();
		const session = this.store.getSession();
		const suggestion = this.getSuggestionById(id);

		if (!context || !session || session.notePath !== context.filePath || !suggestion) {
			new Notice("The active note does not match the current review session.");
			return null;
		}

		if (!this.canAcceptSuggestion(id)) {
			new Notice("This suggestion cannot be safely accepted yet.");
			return null;
		}

		const applyPlan = createSuggestionApplyPlan(context.text, suggestion);
		if (!applyPlan) {
			new Notice(`The ${suggestion.operation} suggestion could not be applied safely.`);
			return null;
		}

		const from = context.view.editor.offsetToPos(applyPlan.from);
		const to = context.view.editor.offsetToPos(applyPlan.to);
		context.view.editor.replaceRange(applyPlan.text, from, to);
		const appliedStartOffset = applyPlan.focusStart ?? applyPlan.from;
		const appliedEndOffset = applyPlan.focusEnd ?? applyPlan.from + applyPlan.text.length;
		const appliedFrom = context.view.editor.offsetToPos(appliedStartOffset);
		const appliedTo = context.view.editor.offsetToPos(appliedEndOffset);
		context.view.editor.setSelection(appliedFrom, appliedTo);
		context.view.editor.scrollIntoView({ from: appliedFrom, to: appliedTo }, true);
		context.view.editor.focus();

		await this.registry.clearPersistedReviewDecision(context.filePath, suggestion, { persist: false });
		this.refreshSessionAfterAcceptedEdit(session, suggestion.id);
		const { sessionId, sessionStartedAt } = this.getCurrentSessionTrackingContext();
		await this.registry.syncReviewerSignalsForSession(this.store.getSession(), {
			persist: false,
			sessionId,
			sessionStartedAt,
		});
		this.lastAppliedChange = {
			start: appliedStartOffset,
			end: appliedEndOffset,
			notePath: context.filePath,
			suggestionId: suggestion.id,
			textFingerprint: this.getNoteTextFingerprint(context.view.editor.getValue()),
		};
		if (options?.syncSceneInventory !== false) {
			await this.registry.syncSceneInventoryForSession(this.store.getSession());
		}
		if (!options?.preserveSelection) {
			this.store.selectSuggestion(id);
		}
		if (options?.highlightMode === "muted") {
			this.activeHighlightRange = {
				start: appliedStartOffset,
				end: appliedEndOffset,
			};
			this.activeHighlightTone = "muted";
			this.syncActiveEditorDecorations();
		}

		return {
			start: appliedStartOffset,
			end: appliedEndOffset,
			suggestionId: suggestion.id,
		};
	}

	async deferSuggestion(id: string): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const session = this.getReviewSession();
		const suggestion = this.getSuggestionById(id);
		const { sessionId, sessionStartedAt } = this.getCurrentSessionTrackingContext();
		if (session && suggestion) {
			await this.registry.persistReviewDecision(session.notePath, suggestion, "deferred", {
				persist: false,
				sessionId,
				sessionStartedAt,
			});
		}

		const nextSuggestionId = this.getAdjacentRevealableSuggestionId("next", id, true);
		this.store.updateSuggestionStatus(id, "deferred");
		await this.registry.syncReviewerSignalsForSession(this.store.getSession(), {
			persist: false,
			sessionId,
			sessionStartedAt,
		});
		await this.registry.syncSceneInventoryForSession(this.store.getSession());
		if (nextSuggestionId) {
			this.store.selectSuggestion(nextSuggestionId);
			await this.revealSelectedSuggestion();
			return;
		}

		if (this.shouldShowGuidedSweepHandoff(this.store.getSession())) {
			await this.enterGuidedSweepHandoff();
		}
	}

	async undoLastAppliedSuggestion(): Promise<void> {
		const change = this.lastAppliedChange;
		const context = this.getReviewNoteContext();
		const appliedSuggestion = change ? this.getSuggestionById(change.suggestionId) : null;
		const completedSweep = this.store.getCompletedSweep();
		if (!change || !context || context.filePath !== change.notePath) {
			new Notice("No applied change is ready to undo.");
			return;
		}

		await this.focusReviewLeaf(context.view);
		if (!this.getActiveEditorView()) {
			new Notice("The editor is not available for undo.");
			return;
		}

		const commands = (this.app as typeof this.app & {
			commands?: { executeCommandById: (id: string) => boolean };
		}).commands;
		if (!commands?.executeCommandById("editor:undo")) {
			new Notice("Nothing to undo.");
			return;
		}

		if (appliedSuggestion) {
			await this.registry.clearPersistedReviewDecision(change.notePath, appliedSuggestion, { persist: false });
		}
		this.lastAppliedChange = null;
		if (completedSweep) {
			this.store.setCompletedSweep(null);
			this.store.setGuidedSweep({
				batchId: completedSweep.batchId,
				currentNoteIndex: completedSweep.currentNoteIndex,
				notePaths: [...completedSweep.notePaths],
				startedAt: completedSweep.startedAt,
			});
		}
		this.resyncSessionForActiveNote();
		this.store.selectSuggestion(change.suggestionId);
		await this.revealSuggestionContext(change.suggestionId);
		new Notice("Applied change undone.");
	}

	async jumpToSuggestionTarget(id: string): Promise<void> {
		if (!this.hasReviewSessionContext()) {
			return;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion) {
			return;
		}

		this.store.selectSuggestion(id);
		await this.focusResolvedTarget(getSuggestionPrimaryTarget(suggestion));
	}

	async jumpToSuggestionAnchor(id: string): Promise<void> {
		if (!this.hasReviewSessionContext()) {
			return;
		}

		const suggestion = this.getSuggestionById(id);
		const anchor = suggestion ? getSuggestionAnchorTarget(suggestion) : undefined;
		if (!suggestion || !anchor) {
			return;
		}

		this.store.selectSuggestion(id);
		await this.focusResolvedTarget(anchor);
	}

	async jumpToSuggestionSource(id: string): Promise<void> {
		if (!this.hasReviewSessionContext()) {
			return;
		}

		const suggestion = this.getSuggestionById(id);
		const start = suggestion?.source.startOffset;
		const end = suggestion?.source.endOffset;
		if (!suggestion || start === undefined || end === undefined) {
			return;
		}

		this.store.selectSuggestion(id);
		await this.focusEditorRange(start, end);
	}

	getReviewerProfiles(): ReviewerProfile[] {
		return this.reviewerDirectory.getProfiles();
	}

	getSortedReviewerProfiles(): ReviewerProfile[] {
		return this.reviewerDirectory.getSortedProfiles();
	}

	getReviewerProfile(reviewerId?: string): ReviewerProfile | null {
		return reviewerId ? this.reviewerDirectory.getProfileById(reviewerId) : null;
	}

	getReviewerStats(reviewerId?: string): ReviewerStats | null {
		return reviewerId ? this.reviewerDirectory.getStats(reviewerId) : null;
	}

	getSweepRegistryEntries(): ReviewSweepRegistryEntry[] {
		return this.registry.getSweepRegistryEntries();
	}

	getSceneReviewRecords(options?: { activeBookOnly?: boolean }): SceneReviewRecord[] {
		return this.registry.getSceneReviewRecords(options);
	}

	getTrackingIdentitySummary(options?: { activeBookOnly?: boolean }): {
		editorialIdCount: number;
		genericFrontmatterIdCount: number;
		missingCount: number;
		mode: "editorial-note-ids" | "frontmatter-ids" | "path-fallback" | "radial-timeline";
		rtSceneIdCount: number;
		trackedCount: number;
	} {
		return this.registry.getTrackingIdentitySummary(options);
	}

	getActiveBookScopeInfo(): { label: string | null; sourceFolder: string | null } {
		return this.registry.getActiveBookScopeInfo();
	}

	async syncOperationalMetadata(): Promise<void> {
		await this.registry.syncOperationalMetadata();
	}

	async injectStableNoteIdsIntoTrackedNotes(activeBookOnly = false): Promise<number> {
		const notePaths = this.getSceneReviewRecords({ activeBookOnly }).map((record) => record.notePath);
		const injectedCount = await this.registry.injectStableNoteIds(notePaths);
		this.resyncSessionForActiveNote();
		this.refreshReviewPanel();
		return injectedCount;
	}

	async resetBatchHistory(batchId: string): Promise<{ removedDecisions: number; removedSignals: number; removedSweep: boolean }> {
		const result = await this.registry.resetBatchHistory(batchId);
		await this.savePluginData();
		this.resyncSessionForActiveNote();
		this.refreshReviewPanel();
		return result;
	}

	async resetAllRevisionHistory(): Promise<{ removedDecisions: number; removedSignals: number; removedSweeps: number }> {
		const result = await this.registry.resetAllRevisionHistory();
		await this.closeActiveReviewContext();
		this.store.setGuidedSweep(null);
		this.store.acknowledgeCompletedSweep(null);
		await this.savePluginData();
		this.resyncSessionForActiveNote();
		this.refreshReviewPanel();
		return result;
	}

	getReviewActivitySummary(): {
		accepted: number;
		cleanedSweeps: number;
		completedSweeps: number;
		deferred: number;
		processed: number;
		inProgressSweeps: number;
		pending: number;
		rejected: number;
		rewritten: number;
		totalSuggestions: number;
		totalSweeps: number;
		unresolved: number;
	} {
		return this.registry.getReviewActivitySummary(this.getReviewerProfiles());
	}

	getReviewPanelHeaderDetails(): {
		summary: string;
		warnings: string[];
	} {
		const session = this.store.getSession();
		if (!session) {
			return {
				summary: "",
				warnings: [],
			};
		}

		const parts = [`${session.suggestions.length} suggestions`];
		const guidedSweep = this.getGuidedSweep();
		if (guidedSweep?.notePaths.length) {
			parts.push(`${guidedSweep.notePaths.length} ${this.getSweepUnitLabel(guidedSweep.notePaths.length, session.notePath)}`);
			if (guidedSweep.notePaths.length > 1) {
				parts.push(`${guidedSweep.currentNoteIndex + 1}/${guidedSweep.notePaths.length}`);
			}
		} else {
			const batchId = this.getCurrentBatchId();
			const entry = this.getSweepRegistryEntry(batchId ?? undefined);
			if (entry?.importedNotePaths.length) {
				parts.push(`${entry.importedNotePaths.length} ${this.getSweepUnitLabel(entry.importedNotePaths.length, session.notePath)}`);
			}
		}

		return {
			summary: parts.join(" • "),
			warnings: this.getReviewPanelWarnings(session.notePath),
		};
	}

	usesSceneTerminology(notePath?: string): boolean {
		return this.registry.usesSceneTerminology(notePath);
	}

	getGuidedSweepHandoffState(): GuidedSweepHandoffState | null {
		const guidedSweep = this.getGuidedSweep();
		const session = this.getReviewSession() ?? this.store.getSession();
		if (!guidedSweep || !session || !this.shouldShowGuidedSweepHandoff(session)) {
			return null;
		}

		const currentPath = guidedSweep.notePaths[guidedSweep.currentNoteIndex] ?? session.notePath;
		const nextPath = guidedSweep.notePaths[guidedSweep.currentNoteIndex + 1];
		const isFinal = !nextPath;
		const unitLabel = this.registry.usesSceneTerminology(currentPath) ? "scene" : "note";
		const unitTitle = this.toTitleCase(unitLabel);

		return {
			currentLabel: this.getNoteDisplayLabel(currentPath),
			currentPath,
			isFinal,
			nextLabel: nextPath ? this.getNoteDisplayLabel(nextPath) : undefined,
			nextPath,
			primaryActionLabel: isFinal ? "Finish sweep" : `Next ${unitLabel}`,
			progressLabel: isFinal
				? "You're done with this pass."
				: `${guidedSweep.currentNoteIndex + 1} of ${guidedSweep.notePaths.length}`,
			panelProgressLabel: `${unitTitle} ${guidedSweep.currentNoteIndex + 1} of ${guidedSweep.notePaths.length}`,
			secondaryActionLabel: isFinal ? undefined : "Finish sweep",
			summary: isFinal
				? "You're done with this pass."
				: `All revision notes in this ${unitLabel} are resolved.`,
			title: isFinal ? "All revision notes are resolved" : `${unitTitle} complete`,
			unitLabel,
		};
	}

	getPanelOnlyReviewState(): PanelOnlyReviewState | null {
		return this.getPanelOnlyReviewStateForSession();
	}

	getNextLogicalReviewLaunchTarget(): ReviewLaunchTarget | null {
		if (this.getPostCompletionIdleState()) {
			return null;
		}

		const context = this.getActiveNoteContext();
		const launchState = this.getEditorialistLaunchState(context);
		if (context && launchState.currentNoteHasReviewBlock && launchState.currentNoteStatus !== "completed") {
			return {
				intent: "active",
				label: this.getNoteDisplayLabel(context.filePath),
				notePath: context.filePath,
				unitLabel: launchState.noteUnitLabel,
			};
		}

		if (launchState.nextNotePath && launchState.nextNoteLabel) {
			return {
				intent: "next",
				label: launchState.nextNoteLabel,
				notePath: launchState.nextNotePath,
				unitLabel: launchState.noteUnitLabel,
			};
		}

		const guidedSweep = this.getGuidedSweep();
		if (guidedSweep?.notePaths.length) {
			const candidatePath = guidedSweep.notePaths
				.slice(guidedSweep.currentNoteIndex)
				.find((notePath) => this.isSweepableSceneRecord(this.getSceneReviewRecordByPath(notePath)));
			if (candidatePath) {
				return {
					intent: context?.filePath === candidatePath ? "active" : "next",
					label: this.getNoteDisplayLabel(candidatePath),
					notePath: candidatePath,
					unitLabel: this.registry.usesSceneTerminology(candidatePath) ? "scene" : "note",
				};
			}
		}

		const activeBookCandidate =
			this.getSceneReviewRecords({ activeBookOnly: true }).find((record) => this.isSweepableSceneRecord(record)) ??
			this.getSceneReviewRecords().find((record) => this.isSweepableSceneRecord(record));
		if (!activeBookCandidate) {
			return null;
		}

		return {
			intent: context?.filePath === activeBookCandidate.notePath ? "active" : "next",
			label: activeBookCandidate.noteTitle,
			notePath: activeBookCandidate.notePath,
			unitLabel: this.registry.usesSceneTerminology(activeBookCandidate.notePath) ? "scene" : "note",
		};
	}

	getCompletedSweepPanelState(): CompletedSweepPanelState | null {
		const completedSweep = this.getResolvedCompletedSweepState();
		if (!completedSweep) {
			return null;
		}
		if (this.store.getAcknowledgedCompletedSweepBatchId() === completedSweep.batchId) {
			return null;
		}

		const entry = this.getSweepRegistryEntry(completedSweep.batchId);
		const unitLabel = this.getSweepUnitLabel(
			completedSweep.notePaths.length,
			completedSweep.notePaths[0],
		);
		const nextSteps: CompletedSweepPanelState["nextSteps"] = [
			{ action: "start", label: "Review changes" },
			{ action: "import", label: "Import new revision notes" },
		];
		if ((entry?.importedNotePaths.length ?? 0) > 0) {
			nextSteps.push({ action: "clean", label: "Clean review blocks" });
		}

		return {
			closeLabel: "Close review",
			title: "All revisions complete",
			editsReviewedLabel: `${completedSweep.totalSuggestions} edit${completedSweep.totalSuggestions === 1 ? "" : "s"} reviewed across ${completedSweep.notePaths.length} ${unitLabel}`,
			description: "You've finished this revision pass.",
			durationLabel: this.getCompletedSweepDurationLabel(completedSweep),
			nextSteps,
		};
	}

	getPostCompletionIdleState(): PostCompletionIdleState | null {
		const activeSceneRecords = this.getSceneReviewRecords().filter((record) => record.batchCount > 0);
		if (activeSceneRecords.length === 0) {
			return {
				title: "Editorialist review",
				description:
					"Editorialist reviews two kinds of revision work: imported review passes (contributor notes with accept/reject) and pending edits — free-form revision notes across the active book.",
			};
		}

		const remainingCount = activeSceneRecords.reduce(
			(total, record) => total + record.pendingCount + record.unresolvedCount + record.deferredCount,
			0,
		);
		const inProgressSweeps = this.registry
			.getSweepRegistryEntries()
			.filter((entry) => entry.status === "in_progress").length;
		if (remainingCount > 0 || inProgressSweeps > 0) {
			return null;
		}

		return {
			title: "Editorialist review",
			description:
				"Editorialist reviews two kinds of revision work: imported review passes (contributor notes with accept/reject) and pending edits — free-form revision notes across the active book.",
		};
	}

	async toggleReviewerStarById(reviewerId: string): Promise<void> {
		const updatedProfile = this.reviewerDirectory.toggleStar(reviewerId);
		if (!updatedProfile) {
			return;
		}

		await this.savePluginData();
		this.refreshReviewPanel();
	}

	async openContributorManagementFlow(reviewerId: string): Promise<boolean> {
		const profile = this.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			new Notice("Contributor not found.");
			return false;
		}

		const action = await openEditorialistChoiceModal(this.app, {
			title: "Manage contributor",
			description: `Choose how to update ${profile.displayName}.`,
			choices: [
				{ label: "Edit", value: "strengths" },
				{ label: "Reassign", value: "reassign" },
				{ label: "Merge", value: "merge" },
				{ label: "Delete", value: "delete" },
			],
		});
		if (!action) {
			return false;
		}

		if (action === "strengths") {
			return this.editContributorStrengths(reviewerId);
		}

		if (action === "delete") {
			return this.deleteContributorById(reviewerId);
		}

		return this.reassignContributorById(reviewerId, action);
	}

	async deleteContributorById(reviewerId: string): Promise<boolean> {
		const profile = this.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			new Notice("Contributor not found.");
			return false;
		}

		const confirm = await openEditorialistChoiceModal(this.app, {
			title: "Delete contributor",
			description: `Delete ${profile.displayName} and remove their saved contributor stats? Revision decisions stay in place, but this contributor will be removed from the directory.`,
			choices: [
				{ label: "Delete contributor", value: "delete" },
				{ label: "Cancel", value: "cancel" },
			],
		});
		if (confirm !== "delete") {
			return false;
		}

		await this.registry.removeReviewerSignalsByReviewerId(reviewerId, { persist: false });
		const deletedProfile = this.reviewerDirectory.deleteProfile(reviewerId);
		if (!deletedProfile) {
			new Notice("Contributor not found.");
			return false;
		}

		this.removeContributorFromActiveSession(reviewerId);
		await this.registry.syncReviewerSignalsForSession(this.store.getSession(), {
			persist: false,
			...this.getCurrentSessionTrackingContext(),
		});
		await this.savePluginData();
		this.refreshReviewPanel();
		new Notice(`Deleted ${deletedProfile.displayName}.`);
		return true;
	}

	async deleteAllContributors(): Promise<number> {
		const profiles = this.reviewerDirectory.getProfiles();
		if (profiles.length === 0) {
			return 0;
		}

		const confirm = await openEditorialistChoiceModal(this.app, {
			title: "Delete all contributors",
			description: "Delete all contributor profiles and saved contributor stats? Revision decisions stay in place, but the contributor directory will be cleared.",
			choices: [
				{ label: "Delete all contributors", value: "delete" },
				{ label: "Cancel", value: "cancel" },
			],
		});
		if (confirm !== "delete") {
			return 0;
		}

		await this.registry.clearAllReviewerSignals({ persist: false });
		const removedCount = this.reviewerDirectory.clearProfiles();
		this.removeAllContributorsFromActiveSession();
		await this.registry.syncReviewerSignalsForSession(this.store.getSession(), {
			persist: false,
			...this.getCurrentSessionTrackingContext(),
		});
		await this.savePluginData();
		this.refreshReviewPanel();
		new Notice(`Deleted ${removedCount} contributor${removedCount === 1 ? "" : "s"}.`);
		return removedCount;
	}

	async editContributorStrengths(reviewerId: string): Promise<boolean> {
		const profile = this.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			new Notice("Contributor not found.");
			return false;
		}

		const result = await openContributorStrengthsModal(this.app, { profile });
		if (!result) {
			return false;
		}

		const updatedProfile = this.reviewerDirectory.updateProfile(reviewerId, result);
		if (!updatedProfile) {
			new Notice("Could not update contributor. The name may be blank or already in use.");
			return false;
		}

		this.syncContributorProfileInActiveSession(updatedProfile);
		await this.savePluginData();
		this.refreshReviewPanel();
		new Notice(`Updated ${updatedProfile.displayName}.`);
		return true;
	}

	async reassignContributorById(
		sourceReviewerId: string,
		mode: ContributorReassignmentMode,
	): Promise<boolean> {
		const sourceProfile = this.reviewerDirectory.getProfileById(sourceReviewerId);
		if (!sourceProfile) {
			new Notice("Contributor not found.");
			return false;
		}

		const targetProfiles = this.reviewerDirectory
			.getSortedProfiles()
			.filter((profile) => profile.id !== sourceReviewerId);
		if (mode === "merge" && targetProfiles.length === 0) {
			new Notice("Create another contributor before merging.");
			return false;
		}

		const result = await openContributorReassignmentModal(this.app, {
			mode,
			sourceProfile,
			targetProfiles,
		});
		if (!result) {
			return false;
		}

		let targetProfile = result.targetReviewerId
			? this.reviewerDirectory.getProfileById(result.targetReviewerId)
			: null;
		if (!targetProfile && result.createName) {
			targetProfile = this.reviewerDirectory.ensureProfileFromReassignment(result.createName, sourceProfile);
		}
		if (!targetProfile) {
			new Notice("Target contributor not found.");
			return false;
		}

		if (targetProfile.id === sourceReviewerId) {
			return false;
		}

		await this.registry.reassignReviewerSignals(sourceReviewerId, targetProfile.id, { persist: false });
		const mergedProfile = this.reviewerDirectory.mergeProfiles(sourceReviewerId, targetProfile.id);
		if (!mergedProfile) {
			new Notice("Could not update contributor records.");
			return false;
		}

		this.reassignContributorInActiveSession(sourceReviewerId, mergedProfile);
		await this.registry.syncReviewerSignalsForSession(this.store.getSession(), {
			persist: false,
			...this.getCurrentSessionTrackingContext(),
		});
		await this.savePluginData();
		this.refreshReviewPanel();
		new Notice(
			mode === "merge"
				? `Merged ${sourceProfile.displayName} into ${mergedProfile.displayName}.`
				: `Reassigned ${sourceProfile.displayName} to ${mergedProfile.displayName}.`,
		);
		return true;
	}

	async clearCleanedSweepRecords(): Promise<number> {
		return 0;
	}

	async useSuggestedReviewer(suggestionId: string, reviewerId?: string): Promise<void> {
		const suggestion = this.getSuggestionById(suggestionId);
		const resolvedReviewerId = reviewerId ?? suggestion?.contributor.suggestedReviewerIds[0];
		if (!suggestion || !resolvedReviewerId) {
			return;
		}

		await this.applyReviewerResolutionToMatchingSuggestions(
			suggestion.contributor.raw,
			resolvedReviewerId,
			"suggested",
		);
	}

	async createReviewerFromSuggestion(suggestionId: string): Promise<void> {
		const suggestion = this.getSuggestionById(suggestionId);
		if (!suggestion) {
			return;
		}

		const profile = this.reviewerDirectory.createProfileFromParsedReviewer(suggestion.contributor.raw);
		await this.savePluginData();
		await this.applyReviewerProfileToMatchingSuggestions(suggestion.contributor.raw, profile, "new");
	}

	leaveReviewerUnresolved(suggestionId: string): void {
		const suggestion = this.getSuggestionById(suggestionId);
		if (!suggestion) {
			return;
		}

		const unresolvedContributor = this.createUnresolvedContributor(
			suggestion.contributor.raw,
			suggestion.contributor.suggestedReviewerIds,
		);
		void this.applyContributorToMatchingSuggestions(suggestion.contributor.raw, unresolvedContributor);
	}

	async saveReviewerAliasForSuggestion(suggestionId: string): Promise<void> {
		const suggestion = this.getSuggestionById(suggestionId);
		const rawName = suggestion?.contributor.raw.rawName?.trim();
		const reviewerId = suggestion?.contributor.reviewerId;
		if (!suggestion || !rawName || !reviewerId) {
			return;
		}

		const updatedProfile = this.reviewerDirectory.addAlias(reviewerId, rawName);
		if (!updatedProfile) {
			return;
		}

		await this.savePluginData();
		this.resyncSessionForActiveNote();
	}

	async toggleReviewerStarForSuggestion(suggestionId: string): Promise<void> {
		const suggestion = this.getSuggestionById(suggestionId);
		const reviewerId = suggestion?.contributor.reviewerId;
		if (!reviewerId) {
			return;
		}

		const updatedProfile = this.reviewerDirectory.toggleStar(reviewerId);
		if (!updatedProfile) {
			return;
		}

		await this.savePluginData();
		this.refreshReviewPanel();
	}

	canToggleReviewerStar(suggestionId: string): boolean {
		return Boolean(this.getSuggestionById(suggestionId)?.contributor.reviewerId);
	}

	canSaveReviewerAlias(suggestionId: string): boolean {
		const suggestion = this.getSuggestionById(suggestionId);
		const rawName = suggestion?.contributor.raw.rawName?.trim();
		const reviewerId = suggestion?.contributor.reviewerId;
		if (!suggestion || !rawName || !reviewerId) {
			return false;
		}

		const profile = this.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			return false;
		}

		const normalizedRaw = this.reviewerDirectory.normalizeValue(rawName);
		if (normalizedRaw === this.reviewerDirectory.normalizeValue(profile.displayName)) {
			return false;
		}

		return !profile.aliases.some((alias) => this.reviewerDirectory.normalizeValue(alias) === normalizedRaw);
	}

	canAcceptSuggestion(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion || suggestion.status !== "pending") {
			return false;
		}

		return canApplySuggestionDirectly(suggestion);
	}

	canAcceptSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canAcceptSuggestion(selected.id) : false;
	}

	canRejectSuggestion(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return Boolean(
			suggestion &&
			suggestion.status !== "accepted" &&
			suggestion.status !== "rejected" &&
			suggestion.status !== "rewritten",
		);
	}

	canRejectSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canRejectSuggestion(selected.id) : false;
	}

	canDeferSuggestion(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return Boolean(
			suggestion &&
			suggestion.status !== "accepted" &&
			suggestion.status !== "rejected" &&
			suggestion.status !== "rewritten",
		);
	}

	canMarkSuggestionRewritten(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return Boolean(
			suggestion &&
			suggestion.status !== "accepted" &&
			suggestion.status !== "rejected" &&
			suggestion.status !== "rewritten",
		);
	}

	canRewriteSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canMarkSuggestionRewritten(selected.id) : false;
	}

	canDeferSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canDeferSuggestion(selected.id) : false;
	}

	canUndoLastAppliedSuggestion(): boolean {
		const context = this.getReviewNoteContext();
		return this.hasCurrentLastAppliedChangeForContext(context);
	}

	canApplyAndReviewSceneSuggestions(): boolean {
		const session = this.getReviewSession();
		return Boolean(session?.suggestions.some((suggestion) => this.canApplySuggestionInReviewAllMode(suggestion)));
	}

	private shouldShowUndoForSelectedSuggestion(selectedId: string): boolean {
		const context = this.getReviewNoteContext();
		const change = this.lastAppliedChange;
		return Boolean(
			change &&
			this.hasCurrentLastAppliedChangeForContext(context) &&
			change.suggestionId === selectedId,
		);
	}

	getSuggestionPresentationTone(suggestion: ReviewSuggestion): "active" | "muted" {
		return getSuggestionPresentationTone(suggestion);
	}

	getSuggestionPresentationRank(suggestion: ReviewSuggestion): number {
		return getSuggestionStatusRank(suggestion.status);
	}

	getAppliedReviewState(): AppliedReviewState | null {
		return this.store.getAppliedReview();
	}

	canJumpToSuggestionTarget(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion) {
			return false;
		}

		return this.hasResolvedRange(getSuggestionPrimaryTarget(suggestion));
	}

	canJumpToSuggestionAnchor(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return this.hasResolvedRange(suggestion ? getSuggestionAnchorTarget(suggestion) : undefined);
	}

	canJumpToSuggestionSource(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const source = this.getSuggestionById(id)?.source;
		return Boolean(source && source.startOffset !== undefined && source.endOffset !== undefined);
	}

	private refreshReviewPanel(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(REVIEW_PANEL_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof ReviewPanel) {
				view.render();
			}
		}
	}

	private getActiveNoteContext(): ActiveNoteContext | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!view || !file) {
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				return null;
			}

			return this.getNoteContextByPath(activeFile.path);
		}

		return {
			filePath: file.path,
			text: view.editor.getValue(),
			view,
		};
	}

	private getNoteContextByPath(filePath: string): ActiveNoteContext | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.file?.path !== filePath) {
				continue;
			}

			return {
				filePath: view.file.path,
				text: view.editor.getValue(),
				view,
			};
		}

		return null;
	}

	private getReviewNoteContext(): ActiveNoteContext | null {
		const session = this.store.getSession();
		if (!session) {
			return null;
		}

		const activeContext = this.getActiveNoteContext();
		if (activeContext?.filePath === session.notePath) {
			return activeContext;
		}

		return this.getNoteContextByPath(session.notePath);
	}

	private getActiveEditorSelection(): string | undefined {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const selectedText = view?.editor.getSelection();
		return selectedText?.trim() ? selectedText : undefined;
	}

	private getActiveEditorView(): EditorView | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			return null;
		}

		// @ts-expect-error Obsidian exposes the CM6 instance at runtime but does not type it.
		return view.editor.cm as EditorView;
	}

	private getEditorialistLaunchState(context: ActiveNoteContext | null): EditorialistLaunchState {
		const noteUnitLabel = context && this.registry.usesSceneTerminology(context.filePath) ? "scene" : "note";
		if (!context) {
			return {
				currentNoteHasReviewBlock: false,
				noteUnitLabel,
			};
		}

		const previousSession = this.store.getSession();
		const session = this.registry.applyPersistedReviewState(
			this.reviewEngine.buildSession(
				context.filePath,
				context.text,
				previousSession?.notePath === context.filePath ? previousSession : null,
			),
		);
		if (!session.hasReviewBlock) {
			return {
				currentNoteHasReviewBlock: false,
				noteUnitLabel,
			};
		}

		const hasActiveTrackedBatches = this.getSceneReviewRecords().some((record) => record.batchCount > 0);

		const batchId = this.registry.resolveCurrentBatchId(this.store.getGuidedSweep()?.batchId ?? null, context.text);
		const entry = this.registry.getSweepRegistryEntry(batchId ?? undefined);
		const notePaths = entry ? (entry.sceneOrder.length > 0 ? entry.sceneOrder : entry.importedNotePaths) : [];
		const currentIndex = notePaths.findIndex((path) => path === context.filePath);
		const nextNotePath =
			hasActiveTrackedBatches && currentIndex !== -1 ? notePaths[currentIndex + 1] : undefined;

		return {
			currentNoteHasReviewBlock: true,
			currentNoteStatus: this.hasLiveActionableSuggestions(session.suggestions) ? "ready" : "completed",
			nextNoteLabel: nextNotePath ? this.getNoteDisplayLabel(nextNotePath) : undefined,
			nextNotePath,
			noteUnitLabel,
		};
	}

	private getToolbarState(hasReviewBlock: boolean): ToolbarState | null {
		const pendingEditsState = this.getPendingEditsToolbarState();
		if (pendingEditsState) {
			return pendingEditsState;
		}

		if (!hasReviewBlock) {
			return null;
		}

		const session = this.getReviewSession();
		if (!session) {
			return null;
		}

		const appliedReview = this.store.getAppliedReview();
		if (appliedReview && appliedReview.entries.length > 0) {
			return {
				mode: "applied_review",
				canUndo: this.canUndoLastAppliedSuggestion(),
				currentIndexLabel: `${appliedReview.currentIndex + 1} of ${appliedReview.entries.length}`,
				title: "Review applied changes",
			};
		}

		const completedReview = this.getCompletedReviewPreviewState(session);
		if (completedReview) {
			return {
				mode: "completed_review",
				currentIndexLabel: completedReview.currentIndexLabel,
				title: completedReview.title,
				canNext: this.getAdjacentCompletedReviewSuggestionId("next") !== null,
				canPrevious: this.getAdjacentCompletedReviewSuggestionId("previous") !== null,
				canUndo: Boolean(this.lastAppliedChange),
			};
		}

		const acceptedReview = this.getAcceptedReviewPreviewState(session);
		if (acceptedReview) {
			return {
				mode: "accepted_review",
				canUndo: this.canUndoLastAppliedSuggestion(),
				currentIndexLabel: acceptedReview.currentIndexLabel,
				title: acceptedReview.title,
			};
		}

		const handoff = this.getGuidedSweepHandoffState();
		if (handoff) {
			return {
				mode: "handoff",
				currentLabel: handoff.currentLabel,
				isFinal: handoff.isFinal,
				primaryActionLabel: handoff.primaryActionLabel,
				progressLabel: handoff.progressLabel,
				secondaryActionLabel: handoff.secondaryActionLabel,
				title: handoff.title,
			};
		}

		const panelOnlyState = this.getPanelOnlyReviewStateForSession(session);
		if (panelOnlyState && !this.store.getSelectedSuggestion()) {
			return {
				mode: "panel",
				progressLabel: panelOnlyState.progressLabel,
				remainingLabel: `${panelOnlyState.remainingCount} remaining`,
				title: `Continue in ${panelOnlyState.unitLabel === "scene" ? "this scene" : "this note"}`,
			};
		}

		if (this.bulkApplyConfirmState?.notePath === session.notePath && this.canApplyAndReviewSceneSuggestions()) {
			const count = session.suggestions.filter((suggestion) => this.canApplySuggestionInReviewAllMode(suggestion)).length;
			return {
				mode: "bulk_confirm",
				countLabel: `${count} ${count === 1 ? "change" : "changes"}`,
				title: "Apply to all?",
			};
		}

		const selected = this.store.getSelectedSuggestion();
		if (!selected) {
			if (panelOnlyState) {
				return {
					mode: "panel",
					progressLabel: panelOnlyState.progressLabel,
					remainingLabel: `${panelOnlyState.remainingCount} remaining`,
					title: `Continue in ${panelOnlyState.unitLabel === "scene" ? "this scene" : "this note"}`,
				};
			}
			return null;
		}

		const suggestions = session.suggestions;
		const selectedIndex = suggestions.findIndex((suggestion) => suggestion.id === selected.id);
		const pendingCount = suggestions.filter((suggestion) => this.getEffectiveSuggestionStatus(suggestion) === "pending").length;
		const unresolvedSuggestions = suggestions
			.map((suggestion, index) => ({ suggestion, index }))
			.filter(({ suggestion }) => this.getEffectiveSuggestionStatus(suggestion) === "unresolved");
		const unresolvedCount = unresolvedSuggestions.length;
		const acceptedCount = suggestions.filter((suggestion) => this.getEffectiveSuggestionStatus(suggestion) === "accepted").length;
		const rejectedCount = suggestions.filter((suggestion) => this.getEffectiveSuggestionStatus(suggestion) === "rejected").length;
		const deferredCount = suggestions.filter((suggestion) => this.getEffectiveSuggestionStatus(suggestion) === "deferred").length;
		const rewrittenCount = suggestions.filter((suggestion) => this.getEffectiveSuggestionStatus(suggestion) === "rewritten").length;
		const canUndoLastAccept = this.shouldShowUndoForSelectedSuggestion(selected.id);
		const guidedSweep = this.getGuidedSweep();
		const unitLabel = this.getSweepUnitLabel(guidedSweep?.notePaths.length ?? 0, session.notePath);
		const sceneProgressLabel =
			guidedSweep && guidedSweep.notePaths.length > 1
				? `${this.toTitleCase(unitLabel.slice(0, -1))} ${guidedSweep.currentNoteIndex + 1} of ${guidedSweep.notePaths.length}`
				: undefined;

		return {
			mode: "review",
			anchorDirection: this.getActiveMoveAnchorDirection(selected),
			hasReviewBlock,
			completionLabel: this.isSweepComplete(suggestions) ? "sweep complete" : undefined,
			pendingCount,
			acceptedCount,
			rejectedCount,
			deferredCount,
			rewrittenCount,
			sceneProgressLabel,
			selectedIndexLabel:
				selectedIndex === -1 ? `${suggestions.length} total` : `${selectedIndex + 1} of ${suggestions.length}`,
			unresolvedCount,
			unresolvedDetails:
				unresolvedSuggestions.length > 0
					? `Unresolved items: ${unresolvedSuggestions.map(({ index }) => index + 1).join(", ")}`
					: undefined,
			canApply: this.canAcceptSelectedSuggestion(),
			canDefer: this.canDeferSelectedSuggestion(),
			canRewrite: this.canRewriteSelectedSuggestion(),
			canNext: this.getAdjacentRevealableSuggestionId("next") !== null,
			canPrevious: this.getAdjacentRevealableSuggestionId("previous") !== null,
			canReject: this.canRejectSelectedSuggestion(),
			canUndoLastAccept,
			operation: selected.operation,
			operationLabel: selected.operation.toUpperCase(),
			selectedLabel: selectedIndex === -1 ? "Current suggestion" : `Suggestion ${selectedIndex + 1} of ${suggestions.length}`,
		};
	}

	private async openNextSweepNoteFromLaunch(): Promise<void> {
		const context = this.getActiveNoteContext();
		if (!context) {
			new Notice("No active markdown note to continue from.");
			return;
		}

		const launchState = this.getEditorialistLaunchState(context);
		const unitLabel = launchState.noteUnitLabel;
		if (!launchState.nextNotePath) {
			new Notice(`No next ${unitLabel} is available.`);
			return;
		}

		const batchId = this.registry.resolveCurrentBatchId(this.store.getGuidedSweep()?.batchId ?? null, context.text);
		const entry = this.registry.getSweepRegistryEntry(batchId ?? undefined);
		if (!entry) {
			await this.startOrResumeReviewForNote(launchState.nextNotePath);
			return;
		}

		const notePaths = entry.sceneOrder.length > 0 ? entry.sceneOrder : entry.importedNotePaths;
		const currentNoteIndex = notePaths.findIndex((path) => path === context.filePath);
		if (currentNoteIndex === -1) {
			await this.startOrResumeReviewForNote(launchState.nextNotePath);
			return;
		}

		this.store.setGuidedSweep({
			batchId: entry.batchId,
			currentNoteIndex,
			notePaths,
			startedAt: entry.importedAt,
		});
		await this.registry.updateSweepRegistry(entry.batchId, {
			currentNotePath: context.filePath,
			sceneOrder: notePaths,
			status: "in_progress",
		});
		await this.workflow.advanceGuidedSweep();
	}

	private syncActiveEditorDecorations(): void {
		const editorView = this.getActiveEditorView();
		const context = this.getActiveNoteContext();
		if (!editorView || !context) {
			this.destroyToolbarOverlay();
			return;
		}

		const hasReviewBlock = noteContainsReviewBlock(context.text);
		const highlight = this.hasReviewSessionContext() ? this.activeHighlightRange : null;
		const toolbarState = this.getToolbarState(hasReviewBlock);

		syncReviewDecorations(editorView, this.getReviewDecorationSnapshot(highlight));
		this.syncToolbarOverlay(editorView, toolbarState, highlight);
	}

	private resyncSessionForActiveNote(): void {
		const context = this.getReviewNoteContext() ?? this.getActiveNoteContext();
		const session = this.store.getSession();
		if (!context) {
			this.bulkApplyConfirmState = null;
			this.store.setAppliedReview(null);
			this.clearActiveHighlights();
			this.lastAppliedChange = null;
			if (session) {
				this.store.clearSession();
			}
			return;
		}

		if (!session || session.notePath !== context.filePath) {
			this.bulkApplyConfirmState = null;
			this.store.setAppliedReview(null);
			this.clearActiveHighlights();
			this.lastAppliedChange = null;
			return;
		}

		if (!this.hasCurrentLastAppliedChangeForContext(context)) {
			this.lastAppliedChange = null;
		}

		const refreshedSession = this.reviewEngine.buildSession(context.filePath, context.text, session);
		const hydratedSession = this.registry.applyPersistedReviewState(refreshedSession);
		void this.persistContributorProfilesIfNeeded();
		if (!hydratedSession.hasReviewBlock) {
			this.bulkApplyConfirmState = null;
			this.store.setAppliedReview(null);
			this.clearActiveHighlights();
			this.lastAppliedChange = null;
			this.store.clearSession();
			return;
		}

		const preferredSelectionId = this.store.getState().selectedSuggestionId;
		if (this.bulkApplyConfirmState?.notePath !== hydratedSession.notePath) {
			this.bulkApplyConfirmState = null;
		}
		this.store.setSession(hydratedSession, preferredSelectionId);
		this.syncSelectionForSession(hydratedSession, preferredSelectionId);
		void this.workflow.syncCurrentNote(context.filePath);
		void this.registry.syncReviewerSignalsForSession(hydratedSession, {
			...this.getCurrentSessionTrackingContext(),
		});
		this.setDefaultHighlightForSelection();
	}

	private refreshSessionAfterAcceptedEdit(session: ReviewSession, acceptedSuggestionId: string): void {
		const context = this.getReviewNoteContext();
		if (!context) {
			return;
		}

		const refreshedSuggestions = this.reviewEngine.refreshSuggestions(
			context.view.editor.getValue(),
			session.suggestions.map((item) =>
				item.id === acceptedSuggestionId
					? {
							...item,
							status: "accepted",
						}
					: item,
			),
		);

		this.store.replaceSuggestions(refreshedSuggestions);
	}

	private getSuggestionById(id: string): ReviewSuggestion | null {
		const session = this.store.getSession();
		return session?.suggestions.find((suggestion) => suggestion.id === id) ?? null;
	}

	private applyReviewerResolutionToMatchingSuggestions(
		raw: ParsedReviewerReference,
		reviewerId: string,
		resolutionStatus: ReviewerResolutionStatus,
	): Promise<void> {
		const profile = this.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			new Notice(`Reviewer profile "${reviewerId}" was not found.`);
			return Promise.resolve();
		}

		return this.applyReviewerProfileToMatchingSuggestions(raw, profile, resolutionStatus);
	}

	private applyReviewerProfileToMatchingSuggestions(
		raw: ParsedReviewerReference,
		profile: ReviewerProfile,
		resolutionStatus: ReviewerResolutionStatus,
	): Promise<void> {
		const contributor = this.createResolvedContributor(raw, profile, resolutionStatus);
		return this.applyContributorToMatchingSuggestions(raw, contributor);
	}

	private async applyContributorToMatchingSuggestions(raw: ParsedReviewerReference, contributor: ReviewSuggestion["contributor"]): Promise<void> {
		const session = this.store.getSession();
		if (!session) {
			return;
		}

		this.store.replaceSuggestions(
			session.suggestions.map((suggestion) =>
				this.sameRawReviewer(suggestion.contributor.raw, raw)
					? {
							...suggestion,
							contributor,
						}
					: suggestion,
			),
		);
		await this.registry.syncReviewerSignalsForSession(this.store.getSession(), {
			...this.getCurrentSessionTrackingContext(),
		});
	}

	private createResolvedContributor(
		raw: ParsedReviewerReference,
		profile: ReviewerProfile,
		resolutionStatus: ReviewerResolutionStatus,
	): ReviewSuggestion["contributor"] {
		return {
			id: profile.id,
			displayName: profile.displayName,
			kind: profile.kind,
			reviewerType: profile.reviewerType,
			provider: profile.provider,
			model: profile.model,
			reviewerId: profile.id,
			resolutionStatus,
			suggestedReviewerIds: [],
			raw,
		};
	}

	private reassignContributorInActiveSession(sourceReviewerId: string, targetProfile: ReviewerProfile): void {
		const session = this.store.getSession();
		if (!session) {
			return;
		}

		const nextSuggestions = session.suggestions.map((suggestion) => {
			const nextSuggestedReviewerIds = suggestion.contributor.suggestedReviewerIds.includes(sourceReviewerId)
				? [...new Set(suggestion.contributor.suggestedReviewerIds.map((value) => value === sourceReviewerId ? targetProfile.id : value))]
				: suggestion.contributor.suggestedReviewerIds;

			if (suggestion.contributor.reviewerId !== sourceReviewerId) {
				if (nextSuggestedReviewerIds === suggestion.contributor.suggestedReviewerIds) {
					return suggestion;
				}

				return {
					...suggestion,
					contributor: {
						...suggestion.contributor,
						suggestedReviewerIds: nextSuggestedReviewerIds,
					},
				};
			}

			return {
				...suggestion,
				contributor: {
					...this.createResolvedContributor(suggestion.contributor.raw, targetProfile, "alias"),
					suggestedReviewerIds: nextSuggestedReviewerIds,
				},
			};
		});

		this.store.replaceSuggestions(nextSuggestions);
	}

	private syncContributorProfileInActiveSession(profile: ReviewerProfile): void {
		const session = this.store.getSession();
		if (!session) {
			return;
		}

		this.store.replaceSuggestions(
			session.suggestions.map((suggestion) =>
				suggestion.contributor.reviewerId !== profile.id
					? suggestion
					: {
							...suggestion,
							contributor: {
								...suggestion.contributor,
								displayName: profile.displayName,
								kind: profile.kind,
								model: profile.model,
								provider: profile.provider,
								reviewerType: profile.reviewerType,
							},
						},
			),
		);
	}

	private removeContributorFromActiveSession(reviewerId: string): void {
		const session = this.store.getSession();
		if (!session) {
			return;
		}

		this.store.replaceSuggestions(
			session.suggestions.map((suggestion) => {
				const nextSuggestedReviewerIds = suggestion.contributor.suggestedReviewerIds.filter((value) => value !== reviewerId);
				if (suggestion.contributor.reviewerId !== reviewerId) {
					if (nextSuggestedReviewerIds.length === suggestion.contributor.suggestedReviewerIds.length) {
						return suggestion;
					}

					return {
						...suggestion,
						contributor: {
							...suggestion.contributor,
							suggestedReviewerIds: nextSuggestedReviewerIds,
						},
					};
				}

				return {
					...suggestion,
					contributor: this.createUnresolvedContributor(suggestion.contributor.raw, nextSuggestedReviewerIds),
				};
			}),
		);
	}

	private removeAllContributorsFromActiveSession(): void {
		const session = this.store.getSession();
		if (!session) {
			return;
		}

		this.store.replaceSuggestions(
			session.suggestions.map((suggestion) => ({
				...suggestion,
				contributor: this.createUnresolvedContributor(suggestion.contributor.raw, []),
			})),
		);
	}

	private createUnresolvedContributor(
		raw: ParsedReviewerReference,
		suggestedReviewerIds: string[],
	): ReviewSuggestion["contributor"] {
		const seed = deriveContributorIdentitySeed(raw);
		return {
			id: raw.rawName ? `parsed-${this.reviewerDirectory.normalizeValue(raw.rawName).replace(/\s+/g, "-")}` : "parsed-unknown-reviewer",
			displayName: seed.displayName,
			kind: seed.kind,
			reviewerType: seed.reviewerType,
			provider: seed.provider,
			model: seed.model,
			reviewerId: undefined,
			resolutionStatus: "unresolved",
			suggestedReviewerIds,
			raw,
		};
	}

	private sameRawReviewer(left: ParsedReviewerReference, right: ParsedReviewerReference): boolean {
		return (
			(left.rawName ?? "").trim() === (right.rawName ?? "").trim() &&
			(left.rawType ?? "").trim() === (right.rawType ?? "").trim() &&
			(left.rawProvider ?? "").trim() === (right.rawProvider ?? "").trim() &&
			(left.rawModel ?? "").trim() === (right.rawModel ?? "").trim()
		);
	}

	private getReviewSession(): ReviewSession | null {
		const context = this.getReviewNoteContext();
		const session = this.store.getSession();
		if (!context || !session || session.notePath !== context.filePath) {
			return null;
		}

		return session;
	}

	private getGuidedSweep(): GuidedSweepState | null {
		return this.store.getGuidedSweep();
	}

	private getSweepRegistryEntry(batchId?: string): ReviewSweepRegistryEntry | null {
		return this.registry.getSweepRegistryEntry(batchId);
	}

	private getCurrentBatchId(): string | null {
		const context = this.getReviewNoteContext() ?? this.getActiveNoteContext();
		if (!context) {
			return null;
		}

		return this.workflow.getCurrentBatchId(context.text);
	}

	private getCurrentSessionTrackingContext(): {
		sessionId?: string;
		sessionStartedAt?: number;
	} {
		const sessionId = this.getCurrentBatchId() ?? undefined;
		return {
			sessionId,
			sessionStartedAt: sessionId ? this.getSweepRegistryEntry(sessionId)?.importedAt : undefined,
		};
	}

	private hasReviewSessionContext(): boolean {
		return Boolean(this.getReviewSession());
	}

	private hasActiveReviewSession(): boolean {
		return Boolean(this.getReviewSession()?.suggestions.length);
	}

	private async revealSelectedSuggestion(): Promise<void> {
		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			this.clearActiveHighlights();
			this.syncActiveEditorDecorations();
			return;
		}

		await this.revealSuggestionContext(selectedSuggestion.id);
	}

	private async revealSuggestionContext(id: string): Promise<void> {
		const suggestion = this.getSuggestionById(id);
		if (!suggestion) {
			this.clearActiveHighlights();
			this.syncActiveEditorDecorations();
			return;
		}

		if (suggestion.operation === "move") {
			const sourceRange = this.getResolvedOffsetRange(getSuggestionPrimaryTarget(suggestion));
			const anchorRange = this.getResolvedOffsetRange(getSuggestionAnchorTarget(suggestion));
			if (sourceRange) {
				this.activeAnchorHighlightRange = anchorRange;
				await this.focusEditorRange(
					sourceRange.start,
					sourceRange.end,
					this.getSuggestionHighlightTone(suggestion),
				);
				return;
			}

			this.activeAnchorHighlightRange = null;
			if (await this.focusResolvedTarget(getSuggestionAnchorTarget(suggestion), "anchor")) {
				return;
			}
		} else if (await this.focusResolvedTarget(getSuggestionPrimaryTarget(suggestion), this.getSuggestionHighlightTone(suggestion))) {
			this.activeAnchorHighlightRange = null;
			return;
		}
		this.clearActiveHighlights();
		this.syncActiveEditorDecorations();
	}

	private async focusResolvedTarget(
		target?: ReviewTargetRef,
		tone: HighlightTone = "active",
	): Promise<boolean> {
		if (!target || !this.hasResolvedRange(target)) {
			return false;
		}

		const start = target.startOffset;
		const end = target.endOffset;
		if (start === undefined || end === undefined) {
			return false;
		}

		await this.focusEditorRange(start, end, tone);
		return true;
	}

	private hasResolvedRange(target?: ReviewTargetRef): boolean {
		return Boolean(target && target.startOffset !== undefined && target.endOffset !== undefined);
	}

	private canRevealSuggestionInManuscript(suggestion: ReviewSuggestion): boolean {
		if (!this.isSuggestionOpen(suggestion)) {
			return false;
		}

		if (this.hasResolvedRange(getSuggestionPrimaryTarget(suggestion))) {
			return true;
		}

		return this.hasResolvedRange(getSuggestionAnchorTarget(suggestion));
	}

	private getAdjacentRevealableSuggestionId(
		direction: "next" | "previous",
		fromId?: string,
		treatCurrentAsDeferred = false,
	): string | null {
		const session = this.getReviewSession();
		if (!session || session.suggestions.length === 0) {
			return null;
		}

		const suggestions = session.suggestions;
		const currentId = fromId ?? this.store.getState().selectedSuggestionId;
		const currentIndex = currentId
			? suggestions.findIndex((suggestion) => suggestion.id === currentId)
			: -1;
		const normalizedStartIndex =
			currentIndex === -1
				? direction === "next"
					? suggestions.length - 1
					: 0
				: currentIndex;

		for (const tier of [0, 1, 2]) {
			for (let offset = 1; offset <= suggestions.length; offset += 1) {
				const index =
					direction === "next"
						? (normalizedStartIndex + offset) % suggestions.length
						: (normalizedStartIndex - offset + suggestions.length) % suggestions.length;
				const suggestion = suggestions[index];
				if (
					suggestion &&
					this.getSuggestionTraversalTier(
						suggestion,
						treatCurrentAsDeferred && suggestion.id === fromId,
					) === tier
				) {
					return suggestion.id;
				}
			}
		}

		return null;
	}

	private getSuggestionTraversalTier(suggestion: ReviewSuggestion, forceDeferred = false): number | null {
		if (!this.isSuggestionOpen(suggestion)) {
			return null;
		}

		if (this.canRevealSuggestionInManuscript(suggestion)) {
			if (forceDeferred || suggestion.status === "deferred") {
				return 1;
			}

			return 0;
		}

		if (forceDeferred || suggestion.status === "deferred") {
			return 1;
		}

		return 2;
	}

	private selectPreferredSuggestionForSession(preferredSelectionId?: string | null): void {
		const session = this.store.getSession();
		if (!session) {
			return;
		}

		if (
			preferredSelectionId &&
			session.suggestions.some((suggestion) => suggestion.id === preferredSelectionId)
		) {
			this.store.selectSuggestion(preferredSelectionId);
			return;
		}

		this.store.selectSuggestion(this.findPreferredSuggestionId(session.suggestions));
	}

	private findPreferredSuggestionId(suggestions: ReviewSuggestion[]): string | null {
		for (const tier of [0, 1, 2]) {
			const match = suggestions.find((suggestion) => this.getSuggestionTraversalTier(suggestion) === tier);
			if (match) {
				return match.id;
			}
		}

		return suggestions[0]?.id ?? null;
	}

	private shouldShowGuidedSweepHandoff(session?: ReviewSession | null): boolean {
		const targetSession = session ?? this.getReviewSession();
		return Boolean(this.getGuidedSweep() && targetSession && !this.hasLiveActionableSuggestions(targetSession.suggestions));
	}

	private hasLiveActionableSuggestions(suggestions: ReviewSuggestion[]): boolean {
		return suggestions.some((suggestion) => this.isSuggestionOpen(suggestion));
	}

	private canApplySuggestionInReviewAllMode(suggestion: ReviewSuggestion): boolean {
		return suggestion.status !== "unresolved" && suggestion.operation !== "move" && this.canAcceptSuggestion(suggestion.id);
	}

	private getAcceptedReviewPreviewState(session?: ReviewSession | null): AcceptedReviewPreviewState | null {
		const targetSession = session ?? this.getReviewSession();
		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (
			!targetSession ||
			this.hasLiveActionableSuggestions(targetSession.suggestions) ||
			!selectedSuggestion ||
			!this.isAcceptedReviewSuggestion(selectedSuggestion) ||
			!this.shouldShowUndoForSelectedSuggestion(selectedSuggestion.id)
		) {
			return null;
		}

		const acceptedSuggestions = targetSession.suggestions.filter((suggestion) => this.isAcceptedReviewSuggestion(suggestion));
		const currentIndex = acceptedSuggestions.findIndex((suggestion) => suggestion.id === selectedSuggestion.id);
		if (currentIndex === -1) {
			return null;
		}

		return {
			currentIndexLabel: `${currentIndex + 1} of ${acceptedSuggestions.length}`,
			title: "Review accepted changes",
		};
	}

	private getCompletedReviewPreviewState(session?: ReviewSession | null): CompletedReviewPreviewState | null {
		const completedSweep = this.getResolvedCompletedSweepState();
		const targetSession = session ?? this.getReviewSession();
		if (!completedSweep || !targetSession) {
			return null;
		}

		const reviewableSuggestions = targetSession.suggestions.filter((suggestion) =>
			this.isCompletedReviewSuggestion(suggestion),
		);
		if (reviewableSuggestions.length === 0) {
			return {
				title: "All revisions complete",
			};
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		const currentIndex = selectedSuggestion
			? reviewableSuggestions.findIndex((suggestion) => suggestion.id === selectedSuggestion.id)
			: -1;

		return {
			currentIndexLabel:
				currentIndex === -1 ? undefined : `${currentIndex + 1} of ${reviewableSuggestions.length}`,
			title: "All revisions complete",
		};
	}

	private getAdjacentAcceptedSuggestionId(
		direction: "next" | "previous",
		fromId?: string,
	): string | null {
		const session = this.getReviewSession();
		if (!session) {
			return null;
		}

		const acceptedSuggestions = session.suggestions.filter((suggestion) => this.isAcceptedReviewSuggestion(suggestion));
		if (acceptedSuggestions.length === 0) {
			return null;
		}

		const currentId = fromId ?? this.store.getState().selectedSuggestionId;
		const currentIndex = currentId
			? acceptedSuggestions.findIndex((suggestion) => suggestion.id === currentId)
			: -1;
		if (currentIndex === -1) {
			return acceptedSuggestions[0]?.id ?? null;
		}

		const nextIndex =
			direction === "next"
				? (currentIndex + 1) % acceptedSuggestions.length
				: (currentIndex - 1 + acceptedSuggestions.length) % acceptedSuggestions.length;
		return acceptedSuggestions[nextIndex]?.id ?? null;
	}

	private getAdjacentCompletedReviewSuggestionId(
		direction: "next" | "previous",
		fromId?: string,
	): string | null {
		const session = this.getReviewSession();
		if (!session) {
			return null;
		}

		const reviewableSuggestions = session.suggestions.filter((suggestion) =>
			this.isCompletedReviewSuggestion(suggestion),
		);
		if (reviewableSuggestions.length === 0) {
			return null;
		}

		const currentId = fromId ?? this.store.getState().selectedSuggestionId;
		const currentIndex = currentId
			? reviewableSuggestions.findIndex((suggestion) => suggestion.id === currentId)
			: -1;
		if (currentIndex === -1) {
			return reviewableSuggestions[0]?.id ?? null;
		}

		const nextIndex =
			direction === "next"
				? (currentIndex + 1) % reviewableSuggestions.length
				: (currentIndex - 1 + reviewableSuggestions.length) % reviewableSuggestions.length;
		return reviewableSuggestions[nextIndex]?.id ?? null;
	}

	private getPanelOnlyReviewStateForSession(session?: ReviewSession | null): PanelOnlyReviewState | null {
		const targetSession = session ?? this.getReviewSession();
		if (!targetSession) {
			return null;
		}

		const openSuggestions = targetSession.suggestions.filter((suggestion) => this.isSuggestionOpen(suggestion));
		if (openSuggestions.length === 0) {
			return null;
		}

		if (openSuggestions.some((suggestion) => this.canRevealSuggestionInManuscript(suggestion))) {
			return null;
		}

		const guidedSweep = this.getGuidedSweep();
		const unitLabel = this.registry.usesSceneTerminology(targetSession.notePath) ? "scene" : "note";
		const unitTitle = this.toTitleCase(unitLabel);
		const contextLabel = unitLabel === "scene"
			? this.formatSceneContextLabel(targetSession.notePath)
			: undefined;
		const progressLabel =
			guidedSweep && guidedSweep.notePaths.length > 1
				? `${unitTitle} ${guidedSweep.currentNoteIndex + 1} of ${guidedSweep.notePaths.length}`
				: undefined;

		return {
			contextLabel,
			description: `The remaining revision notes apply elsewhere in ${unitLabel === "scene" ? "this scene" : "this note"}.`,
			progressLabel,
			remainingCount: openSuggestions.length,
			title: contextLabel ? `Continue review in ${contextLabel}` : `Continue review in this ${unitLabel}`,
			unitLabel,
		};
	}

	private getSceneReviewRecordByPath(notePath: string): SceneReviewRecord | null {
		return this.getSceneReviewRecords().find((record) => record.notePath === notePath) ?? null;
	}

	private isSweepableSceneRecord(record: SceneReviewRecord | null): boolean {
		if (!record || record.batchCount === 0 || record.status === "cleaned") {
			return false;
		}

		return record.pendingCount > 0 || record.unresolvedCount > 0 || record.deferredCount > 0;
	}

	private isSweepComplete(suggestions: ReviewSuggestion[]): boolean {
		return !suggestions.some((suggestion) => this.isSuggestionOpen(suggestion));
	}

	private isSuggestionOpen(suggestion: ReviewSuggestion): boolean {
		return isSuggestionOpenShared(suggestion);
	}

	private getEffectiveSuggestionStatus(suggestion: ReviewSuggestion): ReviewSuggestion["status"] {
		return getEffectiveSuggestionStatusShared(suggestion);
	}

	private isImplicitlyAcceptedCutSuggestion(suggestion: ReviewSuggestion): boolean {
		return isImplicitlyAcceptedCutSuggestionShared(suggestion);
	}

	private isAcceptedReviewSuggestion(suggestion: ReviewSuggestion): boolean {
		return suggestion.status === "accepted" && this.hasRevealableAcceptedRange(suggestion);
	}

	private hasCurrentLastAppliedChangeForContext(context?: ActiveNoteContext | null): boolean {
		if (!this.lastAppliedChange || !context || context.filePath !== this.lastAppliedChange.notePath) {
			return false;
		}

		return this.getNoteTextFingerprint(context.text) === this.lastAppliedChange.textFingerprint;
	}

	private getNoteTextFingerprint(text: string): string {
		let hash = 5381;
		for (let index = 0; index < text.length; index += 1) {
			hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
		}

		return `${text.length}:${hash >>> 0}`;
	}

	private isCompletedReviewSuggestion(suggestion: ReviewSuggestion): boolean {
		const status = this.getEffectiveSuggestionStatus(suggestion);
		return status === "accepted" || status === "rewritten" || status === "rejected";
	}

	private hasRevealableAcceptedRange(suggestion: ReviewSuggestion): boolean {
		if (this.hasResolvedRange(getSuggestionPrimaryTarget(suggestion))) {
			return true;
		}

		return this.hasResolvedRange(getSuggestionAnchorTarget(suggestion));
	}

	private getSuggestionHighlightTone(suggestion: ReviewSuggestion): "active" | "muted" {
		return suggestion.status === "accepted" ? "muted" : "active";
	}

	private clearActiveHighlights(): void {
		this.activeHighlightRange = null;
		this.activeAnchorHighlightRange = null;
		this.activeHighlightTone = "active";
	}

	private getResolvedOffsetRange(target?: ReviewTargetRef): OffsetRange | null {
		if (!target || !this.hasResolvedRange(target)) {
			return null;
		}

		return {
			start: target.startOffset as number,
			end: target.endOffset as number,
		};
	}

	private getActiveMoveAnchorDirection(suggestion: ReviewSuggestion | null): "above" | "below" | undefined {
		if (!suggestion || suggestion.operation !== "move") {
			return undefined;
		}

		const source = this.getResolvedOffsetRange(getSuggestionPrimaryTarget(suggestion));
		const anchor = this.getResolvedOffsetRange(getSuggestionAnchorTarget(suggestion));
		if (!source || !anchor) {
			return undefined;
		}

		return anchor.start < source.start ? "above" : "below";
	}

	private setDefaultHighlightForSelection(): void {
		if (this.store.getAppliedReview()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			this.clearActiveHighlights();
			return;
		}

		if (selectedSuggestion.operation === "move") {
			const sourceRange = this.getResolvedOffsetRange(getSuggestionPrimaryTarget(selectedSuggestion));
			const anchorRange = this.getResolvedOffsetRange(getSuggestionAnchorTarget(selectedSuggestion));
			this.activeHighlightRange = sourceRange ?? anchorRange;
			this.activeAnchorHighlightRange = sourceRange && anchorRange ? anchorRange : null;
			this.activeHighlightTone = sourceRange ? this.getSuggestionHighlightTone(selectedSuggestion) : "anchor";
			return;
		}

		const target = this.getResolvedOffsetRange(getSuggestionPrimaryTarget(selectedSuggestion))
			? getSuggestionPrimaryTarget(selectedSuggestion)
			: getSuggestionAnchorTarget(selectedSuggestion);

		this.activeHighlightRange = this.getResolvedOffsetRange(target);
		this.activeAnchorHighlightRange = null;
		this.activeHighlightTone = this.getSuggestionHighlightTone(selectedSuggestion);
	}

	private syncSelectionForSession(session: ReviewSession, preferredSelectionId?: string | null): void {
		const appliedReview = this.store.getAppliedReview();
		if (appliedReview && appliedReview.notePath !== session.notePath) {
			this.store.setAppliedReview(null);
		}

		if (this.shouldShowGuidedSweepHandoff(session)) {
			this.store.selectSuggestion(null);
			this.clearActiveHighlights();
			return;
		}

		this.selectPreferredSuggestionForSession(preferredSelectionId);
	}

	private async enterGuidedSweepHandoff(): Promise<void> {
		this.store.setAppliedReview(null);
		this.store.selectSuggestion(null);
		this.clearActiveHighlights();
		this.syncActiveEditorDecorations();
	}

	private async enterCompletedSweepAudit(): Promise<void> {
		const completedSweep = this.getResolvedCompletedSweepState();
		if (completedSweep && !this.store.getCompletedSweep()) {
			this.store.setCompletedSweep(completedSweep);
		}

		await this.ensureCompletedSweepAuditSession();
		this.store.setAppliedReview(null);
		const suggestionId = this.getAdjacentCompletedReviewSuggestionId("next");
		this.store.selectSuggestion(suggestionId);
		await this.revealSelectedSuggestion();
	}

	private async ensureCompletedSweepAuditSession(): Promise<void> {
		const completedSweep = this.getResolvedCompletedSweepState();
		if (!completedSweep) {
			return;
		}

		const currentSession = this.getReviewSession();
		if (
			currentSession &&
			completedSweep.notePaths.includes(currentSession.notePath) &&
			currentSession.suggestions.some((suggestion) => this.isCompletedReviewSuggestion(suggestion))
		) {
			return;
		}

		const targetNotePath =
			completedSweep.notePaths.find((notePath) => {
				const record = this.getSceneReviewRecordByPath(notePath);
				return Boolean(record && record.acceptedCount + record.rewrittenCount + record.rejectedCount > 0);
			}) ?? completedSweep.notePaths[completedSweep.currentNoteIndex] ?? completedSweep.notePaths[0];
		if (!targetNotePath) {
			return;
		}

		await this.startOrResumeReviewForNote(targetNotePath);
	}

	private getResolvedCompletedSweepState(): CompletedSweepState | null {
		const completedSweep = this.store.getCompletedSweep();
		if (completedSweep) {
			return completedSweep;
		}

		if (this.store.getGuidedSweep()) {
			return null;
		}

		const remainingCount = this.getSceneReviewRecords()
			.filter((record) => record.batchCount > 0)
			.reduce((total, record) => total + record.pendingCount + record.unresolvedCount + record.deferredCount, 0);
		if (remainingCount > 0) {
			return null;
		}

		const currentSession = this.getReviewSession();
		if (currentSession && !this.hasLiveActionableSuggestions(currentSession.suggestions)) {
			return {
				batchId: this.getCurrentBatchId() ?? `session-complete:${currentSession.notePath}`,
				completedAt: Date.now(),
				currentNoteIndex: 0,
				notePaths: [currentSession.notePath],
				startedAt: currentSession.parsedAt,
				totalSuggestions: currentSession.suggestions.length,
			};
		}

		const latestCompletedSweep = this.registry
			.getSweepRegistryEntries()
			.find((entry) => entry.status === "completed");
		if (!latestCompletedSweep) {
			return null;
		}

		const notePaths =
			latestCompletedSweep.sceneOrder.length > 0
				? [...latestCompletedSweep.sceneOrder]
				: [...latestCompletedSweep.importedNotePaths];
		if (notePaths.length === 0) {
			return null;
		}

		const currentNoteIndex = Math.max(
			0,
			notePaths.findIndex((path) => path === latestCompletedSweep.currentNotePath),
		);

		return {
			batchId: latestCompletedSweep.batchId,
			completedAt: latestCompletedSweep.updatedAt,
			currentNoteIndex,
			notePaths,
			startedAt: latestCompletedSweep.importedAt,
			totalSuggestions: latestCompletedSweep.totalSuggestions,
		};
	}

	private getCompletedSweepDurationLabel(completedSweep: CompletedSweepState): string | undefined {
		const elapsedMs = completedSweep.completedAt - completedSweep.startedAt;
		if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) {
			return undefined;
		}

		const totalMinutes = Math.round(elapsedMs / 60_000);
		if (totalMinutes < 60) {
			return `Completed in ${totalMinutes}m`;
		}

		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return minutes > 0 ? `Completed in ${hours}h ${minutes}m` : `Completed in ${hours}h`;
	}

	private async enterAppliedReviewMode(entries: AppliedReviewChange[]): Promise<void> {
		const session = this.getReviewSession();
		if (!session || entries.length === 0) {
			return;
		}

		this.store.setAppliedReview({
			currentIndex: 0,
			entries,
			notePath: session.notePath,
		});
		await this.focusAppliedReviewEntry(0);
	}

	private async focusAppliedReviewEntry(index: number): Promise<void> {
		const appliedReview = this.store.getAppliedReview();
		if (!appliedReview || appliedReview.entries.length === 0) {
			return;
		}

		const safeIndex = Math.max(0, Math.min(index, appliedReview.entries.length - 1));
		const entry = appliedReview.entries[safeIndex];
		if (!entry) {
			return;
		}

		this.store.updateAppliedReviewCurrentIndex(safeIndex);
		this.store.selectSuggestion(entry.suggestionId);
		await this.focusEditorRange(entry.start, entry.end);
	}

	private syncAppliedReviewSelection(suggestionId: string | null): void {
		const appliedReview = this.store.getAppliedReview();
		if (!appliedReview) {
			return;
		}

		if (!suggestionId) {
			this.store.setAppliedReview(null);
			return;
		}

		const nextIndex = appliedReview.entries.findIndex((entry) => entry.suggestionId === suggestionId);
		if (nextIndex === -1) {
			this.store.setAppliedReview(null);
			return;
		}

		this.store.updateAppliedReviewCurrentIndex(nextIndex);
	}

	private getReviewDecorationSnapshot(highlight: OffsetRange | null): Parameters<typeof syncReviewDecorations>[1] {
		const appliedReview = this.store.getAppliedReview();
		if (appliedReview && appliedReview.entries.length > 0) {
			return {
				highlights: appliedReview.entries.map((entry, index) => ({
					start: entry.start,
					end: entry.end,
					tone: index === appliedReview.currentIndex ? "applied-active" : "applied",
				})),
			};
		}

		return {
			highlights: [
				...(highlight
					? [
							{
								start: highlight.start,
								end: highlight.end,
								tone: this.activeHighlightTone,
							},
						]
					: []),
				...(this.activeAnchorHighlightRange
					? [
							{
								start: this.activeAnchorHighlightRange.start,
								end: this.activeAnchorHighlightRange.end,
								tone: "anchor" as const,
							},
						]
					: []),
			],
		};
	}

	private getSweepUnitLabel(count: number, notePath?: string): string {
		const singular = this.registry.usesSceneTerminology(notePath) ? "scene" : "note";
		return count === 1 ? singular : `${singular}s`;
	}

	private getNoteDisplayLabel(notePath: string): string {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		return file instanceof TFile ? file.basename : notePath.split("/").pop() ?? notePath;
	}

	private formatSceneContextLabel(notePath: string): string {
		return `Scene ${this.getNoteDisplayLabel(notePath).replace(/^[Ss]cene\s+/u, "")}`;
	}

	private toTitleCase(value: string): string {
		return value.charAt(0).toUpperCase() + value.slice(1);
	}

	private async focusEditorRange(
		start: number,
		end: number,
		tone: HighlightTone = "active",
	): Promise<void> {
		const context = this.getReviewNoteContext();
		if (!context) {
			return;
		}

		await this.focusReviewLeaf(context.view);
		this.activeHighlightRange = { start, end };
		this.activeHighlightTone = tone;
		const from = context.view.editor.offsetToPos(start);
		const to = context.view.editor.offsetToPos(end);
		context.view.editor.setSelection(from, to);
		context.view.editor.scrollIntoView({ from, to }, true);
		context.view.editor.focus();
		this.ensureToolbarViewportClearance(start);
		this.syncActiveEditorDecorations();
	}

	private ensureToolbarViewportClearance(start: number): void {
		const editorView = this.getActiveEditorView();
		if (!editorView) {
			return;
		}

		const coords = editorView.coordsAtPos(start);
		const scrollRect = editorView.scrollDOM.getBoundingClientRect();
		if (!coords) {
			return;
		}

		const topPadding = 110;
		const topOffset = coords.top - scrollRect.top;
		if (topOffset < topPadding) {
			editorView.scrollDOM.scrollTop -= topPadding - topOffset;
		}
		this.scheduleToolbarOverlayPositionUpdate();
	}

	private async focusReviewLeaf(view: MarkdownView): Promise<void> {
		const leaf = this.app.workspace.getLeavesOfType("markdown").find((candidate) => candidate.view === view);
		if (!leaf) {
			return;
		}

		await this.app.workspace.setActiveLeaf(leaf, false, true);
		this.app.workspace.revealLeaf(leaf);
	}

	private syncToolbarOverlay(
		editorView: EditorView | null,
		toolbarState: ToolbarState | null,
		highlight: OffsetRange | null,
	): void {
		const isHandoff = toolbarState?.mode === "handoff";
		const isPanel = toolbarState?.mode === "panel";
		const isPendingEdits = toolbarState?.mode === "pending_edits_review";
		const hasHighlight = Boolean(highlight && highlight.end > highlight.start);
		if (!editorView || !toolbarState || (!isHandoff && !isPanel && !isPendingEdits && !hasHighlight)) {
			this.destroyToolbarOverlay();
			return;
		}

		if (this.toolbarOverlayDismissedSignature !== null) {
			const currentSignature = this.computeToolbarDismissalSignature(toolbarState);
			if (currentSignature === this.toolbarOverlayDismissedSignature) {
				this.destroyToolbarOverlay();
				return;
			}
			this.toolbarOverlayDismissedSignature = null;
		}

		if (this.toolbarOverlayEditorView !== editorView) {
			if (this.toolbarOverlayEditorView) {
				this.toolbarOverlayEditorView.scrollDOM.removeEventListener("scroll", this.toolbarOverlayScrollHandler);
			}

			this.toolbarOverlayEditorView = editorView;
			this.toolbarOverlayEditorView.scrollDOM.addEventListener("scroll", this.toolbarOverlayScrollHandler, {
				passive: true,
			});
		}

		if (this.toolbarOverlayEl) {
			this.toolbarOverlayEl.remove();
		}

		this.toolbarOverlayState = toolbarState;
		this.toolbarOverlayEl = createReviewToolbarElement(this, toolbarState);
		document.body.appendChild(this.toolbarOverlayEl);
		this.measureToolbarOverlayHeight();
		this.toolbarOverlayLastPosition = null;
		this.scheduleToolbarOverlayPositionUpdate();
	}

	private measureToolbarOverlayHeight(): void {
		const toolbar = this.toolbarOverlayEl?.firstElementChild as HTMLElement | null;
		this.toolbarOverlayHeight = toolbar?.getBoundingClientRect().height ?? 0;
	}

	private scheduleToolbarOverlayPositionUpdate(): void {
		if (this.toolbarOverlayFrameId !== null) {
			return;
		}

		this.toolbarOverlayFrameId = window.requestAnimationFrame(() => {
			this.toolbarOverlayFrameId = null;
			this.positionToolbarOverlay();
		});
	}

	private cancelToolbarOverlayPositionUpdate(): void {
		if (this.toolbarOverlayFrameId === null) {
			return;
		}

		window.cancelAnimationFrame(this.toolbarOverlayFrameId);
		this.toolbarOverlayFrameId = null;
	}

	private positionToolbarOverlay(): void {
		if (!this.toolbarOverlayEl || !this.toolbarOverlayEditorView || !this.toolbarOverlayState) {
			return;
		}

		const editorRect = this.toolbarOverlayEditorView.scrollDOM.getBoundingClientRect();
		const toolbarHeight = this.toolbarOverlayHeight;
		const left = editorRect.left + editorRect.width / 2;
		let clampedTop = editorRect.top + 8;
		let isHidden = false;

		if (this.toolbarOverlayState.mode === "review" || this.toolbarOverlayState.mode === "applied_review") {
			if (!this.activeHighlightRange) {
				isHidden = true;
			} else {
				const coords = this.toolbarOverlayEditorView.coordsAtPos(this.activeHighlightRange.start);
				if (!coords) {
					isHidden = true;
				} else {
					const top = coords.top - 50 - toolbarHeight;
					const minimumTop = editorRect.top + 8;
					const maximumTop = editorRect.bottom - 8 - toolbarHeight;
					clampedTop = Math.min(Math.max(top, minimumTop), maximumTop);

					if (coords.bottom < editorRect.top || coords.top > editorRect.bottom) {
						isHidden = true;
					}
				}
			}
		} else {
			const minimumTop = editorRect.top + 12;
			const maximumTop = editorRect.bottom - 8 - toolbarHeight;
			clampedTop = Math.min(Math.max(editorRect.top + 20, minimumTop), maximumTop);
		}

		const nextPosition = {
			hidden: isHidden,
			left: `${left}px`,
			top: `${clampedTop}px`,
		};

		if (this.toolbarOverlayLastPosition?.hidden !== nextPosition.hidden) {
			this.toolbarOverlayEl.classList.toggle("is-hidden", nextPosition.hidden);
		}
		if (!nextPosition.hidden) {
			if (this.toolbarOverlayLastPosition?.left !== nextPosition.left) {
				this.toolbarOverlayEl.style.setProperty("--editorialist-toolbar-overlay-left", nextPosition.left);
			}
			if (this.toolbarOverlayLastPosition?.top !== nextPosition.top) {
				this.toolbarOverlayEl.style.setProperty("--editorialist-toolbar-overlay-top", nextPosition.top);
			}
		}
		this.toolbarOverlayLastPosition = nextPosition;
	}

	private destroyToolbarOverlay(): void {
		this.cancelToolbarOverlayPositionUpdate();
		if (this.toolbarOverlayEditorView) {
			this.toolbarOverlayEditorView.scrollDOM.removeEventListener("scroll", this.toolbarOverlayScrollHandler);
			this.toolbarOverlayEditorView = null;
		}
		this.toolbarOverlayHeight = 0;
		this.toolbarOverlayLastPosition = null;
		this.toolbarOverlayState = null;

		if (this.toolbarOverlayEl) {
			this.toolbarOverlayEl.remove();
			this.toolbarOverlayEl = null;
		}
	}

	private async loadPluginData(): Promise<void> {
		const savedData = (await this.loadData()) as Partial<EditorialistPluginData> | null;
		const reviewerProfiles = Array.isArray(savedData?.reviewerProfiles) ? savedData.reviewerProfiles : [];
		this.registry.load(savedData);
		this.reviewerDirectory.setProfiles(reviewerProfiles);
		this.registry.rebuildReviewerStatsFromSignals();
	}

	private async savePluginData(): Promise<void> {
		await this.saveData(this.registry.buildPluginData(this.reviewerDirectory.getProfiles()));
	}

	private async syncSceneReviewIndex(): Promise<void> {
		await this.registry.syncSceneInventory();
	}

	async openSceneNote(notePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			new Notice("Scene note not found.");
			return;
		}

		await this.app.workspace.openLinkText(notePath, "", false);
	}

	async startOrResumeReviewForNote(notePath: string): Promise<void> {
		await this.openSceneNote(notePath);
		const context =
			this.getNoteContextByPath(notePath) ??
			(this.getActiveNoteContext()?.filePath === notePath ? this.getActiveNoteContext() : null);
		if (!context) {
			new Notice("Could not open the next note for review.");
			return;
		}

		await this.parseReviewContext(context, true);
	}

	async cleanSceneReviewNote(notePath: string): Promise<void> {
		const context = this.getNoteContextByPath(notePath);
		let removedCount = 0;

		if (context) {
			const removed = removeImportedReviewBlocks(context.view.editor.getValue());
			if (removed.removedCount > 0) {
				context.view.editor.setValue(removed.text);
				removedCount = removed.removedCount;
			}
		} else {
			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) {
				new Notice("Scene note not found.");
				return;
			}
			await this.app.vault.process(file, (currentText) => {
				const removed = removeImportedReviewBlocks(currentText);
				removedCount = removed.removedCount;
				return removed.removedCount > 0 ? removed.text : currentText;
			});
		}

		await this.syncSceneReviewIndex();
		this.resyncSessionForActiveNote();
		new Notice(
			removedCount > 0
				? `Cleaned ${removedCount} imported review block${removedCount === 1 ? "" : "s"} from this note.`
				: "No imported review blocks were found in this note.",
		);
	}

	async cleanupSceneReviewNotes(notePaths: string[]): Promise<number> {
		let removedCount = 0;
		for (const notePath of notePaths) {
			const context = this.getNoteContextByPath(notePath);
			if (context) {
				const removed = removeImportedReviewBlocks(context.view.editor.getValue());
				if (removed.removedCount > 0) {
					context.view.editor.setValue(removed.text);
					removedCount += removed.removedCount;
				}
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) {
				continue;
			}

			let currentRemovedCount = 0;
			await this.app.vault.process(file, (currentText) => {
				const removed = removeImportedReviewBlocks(currentText);
				currentRemovedCount = removed.removedCount;
				return removed.removedCount > 0 ? removed.text : currentText;
			});
			removedCount += currentRemovedCount;
		}

		await this.syncSceneReviewIndex();
		this.resyncSessionForActiveNote();
		return removedCount;
	}

	async cleanupCompletedSceneReviewNotes(activeBookOnly = false): Promise<number> {
		const notePaths = this.getSceneReviewRecords({ activeBookOnly })
			.filter((record) => record.status === "completed")
			.map((record) => record.notePath);
		return this.cleanupSceneReviewNotes(notePaths);
	}

	async cleanupAllSceneReviewNotes(activeBookOnly = false): Promise<number> {
		const notePaths = this.getSceneReviewRecords({ activeBookOnly })
			.filter((record) => record.batchCount > 0)
			.map((record) => record.notePath);
		return this.cleanupSceneReviewNotes(notePaths);
	}

	async exportEditorialistMetadata(): Promise<string> {
		await this.syncOperationalMetadata();
		const payload: EditorialistMetadataExport = this.registry.buildMetadataExport(this.getSortedReviewerProfiles());
		const date = new Date();
		const dateLabel = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		let targetPath = normalizePath(`editorialist-data-export-${dateLabel}.json`);
		if (this.app.vault.getAbstractFileByPath(targetPath) instanceof TFile) {
			const timeLabel = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
			targetPath = normalizePath(`editorialist-data-export-${dateLabel}-${timeLabel}.json`);
		}

		await this.app.vault.create(targetPath, JSON.stringify(payload, null, 2));
		return targetPath;
	}

	private getReviewPanelWarnings(notePath: string): string[] {
		return this.registry.getReviewPanelWarnings(notePath);
	}

	private async copyReviewTemplateToClipboard(selectedText?: string): Promise<void> {
		const template = buildReviewTemplate(selectedText);
		await this.copyTextToClipboard(template, "Review template copied", "Could not copy the review template.");
	}

	async copyTextToClipboard(
		text: string,
		successMessage = "Copied to clipboard",
		errorMessage = "Could not copy to the clipboard.",
	): Promise<boolean> {
		if (!navigator.clipboard?.writeText) {
			new Notice("Clipboard access is not available in this environment.");
			return false;
		}

		try {
			await navigator.clipboard.writeText(text);
			new Notice(successMessage);
			return true;
		} catch {
			new Notice(errorMessage);
			return false;
		}
	}

	private async loadClipboardReviewBatch(): Promise<ClipboardReviewBatch | null> {
		if (!navigator.clipboard?.readText) {
			return null;
		}

		try {
			const rawText = await navigator.clipboard.readText();
			const normalizedText = normalizeImportedReviewText(rawText);
			if (!normalizedText) {
				return null;
			}

			const context = this.getActiveNoteContext();
			const batch = await this.importEngine.inspectBatch(normalizedText, {
				activeNotePath: context?.filePath,
			});
			await this.persistContributorProfilesIfNeeded();
			if (batch.summary.totalSuggestions === 0) {
				return null;
			}

			return {
				rawText: normalizedText,
				batch,
			};
		} catch {
			return null;
		}
	}

	private async importReviewBatch(batch: ReviewImportBatch, startReview: boolean): Promise<void> {
		const duplicateSweep = this.registry.findDuplicateSweep(batch);
		if (duplicateSweep) {
			const choice = await openEditorialistChoiceModal(this.app, {
				title: "Possible existing review batch detected",
				description: "This review batch appears to match an existing imported sweep. Open it, import again, or cancel.",
				choices: [
					{ label: "Open existing sweep", value: "open" },
					{ label: "Import anyway", value: "import" },
					{ label: "Cancel", value: "cancel" },
				],
			});
			if (choice === "open") {
				await this.workflow.openExistingSweep(duplicateSweep);
			}
			if (choice !== "import") {
				return;
			}
		}

		const importedGroups = await this.importEngine.importBatch(batch);
		if (importedGroups.length === 0) {
			new Notice("No review blocks were imported.");
			return;
		}

		await this.registry.recordImportedBatch(batch, importedGroups, "in_progress");

		if (!startReview) {
			new Notice(
				`Imported ${importedGroups.reduce((count, group) => count + group.suggestions.length, 0)} suggestions into ${importedGroups.length} note${importedGroups.length === 1 ? "" : "s"}.`,
			);
		}

		if (!startReview) {
			return;
		}

		await this.workflow.startGuidedSweep(
			batch.batchId,
			batch.createdAt,
			importedGroups.map((group) => group.filePath),
		);
	}

	private async importReviewBatchToActiveNote(rawText: string, startReview: boolean): Promise<void> {
		const context = this.getActiveNoteContext();
		if (!context) {
			new Notice("No active markdown note to import into.");
			return;
		}

		const normalizedText = normalizeImportedReviewText(rawText);
		if (!normalizedText) {
			new Notice(`No ${getReviewBlockFenceLabel()} found in the imported text.`);
			return;
		}

		const batch = await this.inspectReviewBatch(rawText, { activeNotePath: context.filePath });
		const duplicateSweep = this.registry.findDuplicateSweep(batch);
		if (duplicateSweep) {
			const choice = await openEditorialistChoiceModal(this.app, {
				title: "Possible existing review batch detected",
				description: "This review batch appears to match an existing imported sweep. Open it, import again, or cancel.",
				choices: [
					{ label: "Open existing sweep", value: "open" },
					{ label: "Import anyway", value: "import" },
					{ label: "Cancel", value: "cancel" },
				],
			});
			if (choice === "open") {
				await this.workflow.openExistingSweep(duplicateSweep);
			}
			if (choice !== "import") {
				return;
			}
		}

		const batchText = this.addImportedBlockMetadata(normalizedText, batch.batchId);

		const currentText = context.view.editor.getValue();
		const trimmedCurrentText = currentText.trimEnd();
		const trimmedBatch = batchText.trim();
		const separator = trimmedCurrentText.length > 0 ? "\n\n" : "";
		const nextText = `${trimmedCurrentText}${separator}${trimmedBatch}\n`;
		context.view.editor.setValue(nextText);
		await this.registry.recordImportedBatch(
			batch,
			[
				{
					filePath: context.filePath,
					fileName: context.view.file?.basename ?? context.filePath,
					sceneId: undefined,
					suggestions: batch.results,
					exactCount: batch.summary.totalExactMatches,
					declaredCount: batch.summary.totalDeclaredRoutes,
					inferredCount: batch.summary.totalInferredRoutes,
					exactInferredCount: batch.results.filter(
						(result) => result.routeStrategy === "inferred_exact" && result.verificationStatus === "exact",
					).length,
					advisoryCount: batch.summary.totalAdvisoryOnly,
					unresolvedCount: batch.summary.totalUnresolvedMatches,
					mismatchCount: batch.summary.totalMismatches,
					isReady: true,
				},
			],
			"in_progress",
			context.filePath,
		);

		if (startReview) {
			await this.workflow.startGuidedSweep(batch.batchId, batch.createdAt, [context.filePath]);
			return;
		}

		new Notice("Imported review block into the active note.");
	}

	private addImportedBlockMetadata(blockText: string, batchId: string): string {
		if (blockText.includes(`BatchId: ${batchId}`)) {
			return blockText;
		}

		return blockText.replace(
			new RegExp(`^\\\`\\\`\\\`${REVIEW_BLOCK_FENCE}\\s*$`, "m"),
			(match) => `${match}\nBatchId: ${batchId}\nImportedBy: Editorialist`,
		);
	}

	private async inspectReviewBatch(
		rawText: string,
		options?: Parameters<ImportEngine["inspectBatch"]>[1],
	): Promise<ReviewImportBatch> {
		const batch = await this.importEngine.inspectBatch(rawText, options);
		await this.persistContributorProfilesIfNeeded();
		return batch;
	}

	private async persistContributorProfilesIfNeeded(): Promise<void> {
		if (!this.reviewerDirectory.consumeDidChange()) {
			return;
		}

		await this.savePluginData();
	}

	async cleanupCurrentReviewBatch(): Promise<void> {
		const context = this.getReviewNoteContext() ?? this.getActiveNoteContext();
		if (!(await this.workflow.cleanupCurrentBatch(context?.text))) {
			new Notice("No imported review batch is active.");
		}
	}

	async cleanupReviewBatchById(batchId: string): Promise<void> {
		await this.cleanupReviewBatch(batchId);
	}

	async cleanupCompletedSweepReviewBlocks(): Promise<void> {
		const completedSweep = this.getResolvedCompletedSweepState();
		if (!completedSweep) {
			new Notice("No completed revision pass is available to clean.");
			return;
		}

		await this.cleanupReviewBatch(completedSweep.batchId);
	}

	async removeImportedReviewBlocksInCurrentNote(): Promise<void> {
		const context = this.getActiveNoteContext();
		if (!context) {
			new Notice("No active markdown note.");
			return;
		}

		const removed = removeImportedReviewBlocks(context.view.editor.getValue());
		if (removed.removedCount === 0) {
			new Notice("No imported Editorialist review blocks found in this note.");
			return;
		}

		context.view.editor.setValue(removed.text);
		await this.registry.syncSceneInventory();
		this.resyncSessionForActiveNote();
		new Notice(`Removed ${removed.removedCount} imported review block${removed.removedCount === 1 ? "" : "s"} from this note.`);
	}

	private async cleanupReviewBatch(batchId: string): Promise<void> {
		const entry = this.getSweepRegistryEntry(batchId);
		if (!entry) {
			new Notice("Review batch registry entry not found.");
			return;
		}

		let removedCount = 0;
		for (const notePath of entry.importedNotePaths) {
			const context = this.getNoteContextByPath(notePath);
			if (context) {
				const removed = removeImportedReviewBlocks(context.view.editor.getValue(), batchId);
				if (removed.removedCount > 0) {
					context.view.editor.setValue(removed.text);
					removedCount += removed.removedCount;
				}
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) {
				continue;
			}

			let currentRemovedCount = 0;
			await this.app.vault.process(file, (currentText) => {
				const removed = removeImportedReviewBlocks(currentText, batchId);
				currentRemovedCount = removed.removedCount;
				return removed.removedCount > 0 ? removed.text : currentText;
			});
			removedCount += currentRemovedCount;
		}

		await this.registry.updateSweepRegistry(
			batchId,
			{
				status: "cleaned",
				cleanedAt: Date.now(),
			},
			{ persist: false },
		);
		if (this.getGuidedSweep()?.batchId === batchId) {
			this.store.setGuidedSweep(null);
		}
		await this.registry.syncSceneInventory();
		this.resyncSessionForActiveNote();
		new Notice(
			removedCount > 0
				? `Cleaned ${removedCount} imported review block${removedCount === 1 ? "" : "s"}.`
				: "No imported review blocks were found for this batch.",
		);
	}
}
