import type { EditorView } from "@codemirror/view";
import { MarkdownView, normalizePath, Notice, Plugin, TFile, type App } from "obsidian";
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
	getEffectiveSuggestionStatus as getEffectiveSuggestionStatusShared,
	getSuggestionAnchorTarget,
	getSuggestionPresentationTone,
	getSuggestionPrimaryTarget,
	isSuggestionOpen as isSuggestionOpenShared,
} from "./core/OperationSupport";
import { isSweepComplete as isSweepCompleteShared } from "./core/review/SweepCompletion";
import {
	canRevealSuggestionInManuscript as canRevealSuggestionInManuscriptShared,
	getAdjacentRevealableSuggestionId as getAdjacentRevealableSuggestionIdShared,
	hasLiveActionableSuggestions as hasLiveActionableSuggestionsShared,
} from "./core/review/SuggestionTraversal";
import { ReviewStateMachine } from "./core/review/ReviewStateMachine";
import { runEditorUndo } from "./core/review/EditorUndo";
import type { ReviewStateMachineHost } from "./core/review/ReviewStateMachineHost";
import { computeNoteTextFingerprint } from "./core/review/SessionAxis";
import {
	noteContainsReviewBlock,
	removeImportedReviewBlocks,
} from "./core/ReviewBlockFormat";
import { ReviewEngine } from "./core/ReviewEngine";
import { buildReviewTemplate, type ReviewTemplateContext } from "./core/ReviewTemplate";
import { getSceneIdForFile, isPathInFolderScope, isSceneClassFile } from "./core/VaultScope";
import { SuggestionParser } from "./core/SuggestionParser";
import type {
	EditorialistMetadataExport,
	ReviewSweepRegistryEntry,
} from "./models/ReviewImport";
import type { ReviewSession, ReviewSuggestion, ReviewTargetRef } from "./models/ReviewSuggestion";
import { CutArchiveService, type CutBackupSourceType } from "./core/CutArchiveService";
import type {
	ParsedContributorReference,
	ContributorProfile,
	ReviewerResolutionStatus,
	SceneReviewRecord,
	ReviewerStats,
} from "./models/ContributorProfile";
import { ReviewStore, type AppliedReviewState, type CompletedSweepState, type GuidedSweepState } from "./state/ReviewStore";
import { DebouncedSaver } from "./state/DebouncedSaver";
import { TrailingDebouncer } from "./state/TrailingDebouncer";
import { ContributorDirectory } from "./state/ContributorDirectory";
import { EditorialismService } from "./services/EditorialismService";
import { migratePluginData } from "./services/PluginDataMigration";
import { ReviewRegistryService } from "./services/ReviewRegistryService";
import { ReviewWorkflowService } from "./services/ReviewWorkflowService";
import { EditorialistModal } from "./ui/EditorialistModal";
import { openEditorialistChoiceModal } from "./ui/EditorialistChoiceModal";
import { openContributorReassignmentModal, type ContributorReassignmentMode } from "./ui/ContributorReassignmentModal";
import { openContributorStrengthsModal } from "./ui/ContributorStrengthsModal";
import { EDITORIALISM_PANEL_VIEW_TYPE, EditorialismPanel } from "./ui/EditorialismPanel";
import { REVIEW_PANEL_VIEW_TYPE, ReviewPanel } from "./ui/ReviewPanel";
import { EditorialistSettingTab } from "./ui/EditorialistSettingTab";
import { createReviewDecorationsExtension, syncReviewDecorations } from "./ui/Decorations";
import { createReviewToolbarElement, type ToolbarState } from "./ui/Toolbar";
import { ToolbarKeyTracker } from "./ui/toolbar/ToolbarKeyTracker";
import { ToolbarOverlayController } from "./orchestrators/ToolbarOverlayController";
import { ReviewBatchProcessor } from "./orchestrators/ReviewBatchProcessor";
import { PendingEditsCoordinator, type PendingEditsSummary } from "./orchestrators/PendingEditsCoordinator";
import { buildToolbarState } from "./ui/viewmodels/ToolbarViewModel";
import type { ReviewBranchInputs, ToolbarStateInputs } from "./ui/viewmodels/ToolbarStateInputs";
import {
	SessionOrchestrator,
	type ActiveNoteContext,
	type BulkApplyConfirmState,
	type LastAppliedChange,
} from "./orchestrators/SessionOrchestrator";
import { ReviewActionsOrchestrator } from "./orchestrators/ReviewActionsOrchestrator";

interface OffsetRange {
	end: number;
	start: number;
}

type HighlightTone = "active" | "muted" | "anchor";

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
		action?: "clean" | "import" | "pending" | "start";
		label: string;
		scenePath?: string;
	}>;
	title: string;
}

interface PostCompletionIdleState {
	description: string;
	title: string;
}

export interface ReviewStateIndexEntry {
	notePath: string;
	noteTitle: string;
	sceneId?: string;
	pendingCount: number;
	deferredCount: number;
	processedCount: number;
	lastUpdated: number;
}

export interface ReviewStateOverview {
	pending: ReviewStateIndexEntry[];
	processed: ReviewStateIndexEntry[];
}

interface ReviewLaunchTarget {
	intent: "active" | "next";
	label: string;
	notePath: string;
	unitLabel: "note" | "scene";
}

export type { PendingEditsSummary };

export default class EditorialistPlugin extends Plugin {
	private readonly store = new ReviewStore();

	private readonly reviewerDirectory = new ContributorDirectory();
	private readonly parser = new SuggestionParser(this.reviewerDirectory);
	private readonly matchEngine = new MatchEngine();
	private readonly reviewEngine = new ReviewEngine(this.parser, this.matchEngine);
	private readonly registry = new ReviewRegistryService(
		this.app,
		this.reviewEngine,
		this.reviewerDirectory,
		() => this.savePluginData(),
		(notePath) => this.resolveOpenNoteText(notePath),
	);
	private readonly cutArchive = new CutArchiveService(this.app, {
		getCutFolderOverride: () => this.registry.getCutFolderOverride(),
		getActiveBookScope: () => this.registry.getActiveBookScopeInfo(),
	});
	private readonly editorialismService = new EditorialismService(this.app);
	private readonly workflow = new ReviewWorkflowService(this.store, this.registry, {
		clearReviewSelection: async () => {
			this.store.selectSuggestion(null);
			await this.revealSelectedSuggestion();
		},
		cleanupBatchById: async (batchId) => {
			await this.batchProcessor.cleanupReviewBatch(batchId);
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
	private readonly toolbarKeyTracker = new ToolbarKeyTracker();
	getToolbarKeyTracker(): ToolbarKeyTracker {
		return this.toolbarKeyTracker;
	}
	private readonly toolbarOverlay = new ToolbarOverlayController({
		getActiveHighlightRange: () => this.activeHighlightRange,
		getSelectedSuggestionId: () => this.store.getState().selectedSuggestionId ?? null,
		createToolbarElement: (state) => createReviewToolbarElement(this, state),
	});
	private readonly batchProcessor = new ReviewBatchProcessor({
		app: this.app,
		getImportEngine: () => this.importEngine,
		getActiveNoteContext: () => this.getActiveNoteContext(),
		getReviewNoteContext: () => this.getReviewNoteContext(),
		getNoteContextByPath: (filePath) => this.getNoteContextByPath(filePath),
		getResolvedCompletedSweepState: () => this.getResolvedCompletedSweepState(),
		getGuidedSweep: () => this.getGuidedSweep(),
		setGuidedSweep: (value) => this.store.setGuidedSweep(value),
		persistContributorProfilesIfNeeded: () => this.persistContributorProfilesIfNeeded(),
		savePluginData: () => this.savePluginData(),
		resyncSessionForActiveNote: () => this.resyncSessionForActiveNote(),
		refreshReviewPanel: () => this.refreshReviewPanel(),
		findDuplicateSweep: (batch) => this.registry.findDuplicateSweep(batch),
		recordImportedBatch: (batch, groups, status, currentNotePath) =>
			this.registry.recordImportedBatch(batch, groups, status, currentNotePath),
		getSweepRegistryEntry: (batchId) => this.getSweepRegistryEntry(batchId),
		updateSweepRegistry: (batchId, updates, options) =>
			this.registry.updateSweepRegistry(batchId, updates, options),
		syncSceneInventory: () => this.registry.syncSceneInventory(),
		getSceneReviewRecords: () => this.registry.getSceneReviewRecords(),
		resetBatchHistoryInRegistry: (batchId) => this.registry.resetBatchHistory(batchId),
		openExistingSweep: (entry) => this.workflow.openExistingSweep(entry),
		startGuidedSweep: (batchId, importedAt, notePaths) =>
			this.workflow.startGuidedSweep(batchId, importedAt, notePaths),
		cleanupCurrentBatch: (noteText) => this.workflow.cleanupCurrentBatch(noteText),
	});
	private readonly pendingEdits = new PendingEditsCoordinator({
		app: this.app,
		refreshReviewPanel: () => this.refreshReviewPanel(),
		syncActiveEditorDecorations: () => this.syncActiveEditorDecorations(),
		openReviewPanel: () => this.openReviewPanel(),
		closeSettingsModal: () => this.closeSettingsModal(),
	});

	private readonly sessionOrchestrator = new SessionOrchestrator({
		store: this.store,
		reviewEngine: this.reviewEngine,
		registry: this.registry,
		workflow: this.workflow,
		getActiveNoteContext: () => this.getActiveNoteContext(),
		getReviewNoteContext: () => this.getReviewNoteContext(),
		getReviewSession: () => this.getReviewSession(),
		getLastAppliedChange: () => this.lastAppliedChange,
		setLastAppliedChange: (value) => {
			this.lastAppliedChange = value;
		},
		getBulkApplyConfirmState: () => this.bulkApplyConfirmState,
		setBulkApplyConfirmState: (value) => {
			this.bulkApplyConfirmState = value;
		},
		clearActiveHighlights: () => this.clearActiveHighlights(),
		setDefaultHighlightForSelection: () => this.setDefaultHighlightForSelection(),
		getResolvedCompletedSweepState: () => this.getResolvedCompletedSweepState(),
		isCompletedReviewSuggestion: (suggestion) => this.isCompletedReviewSuggestion(suggestion),
		getSceneReviewRecordByPath: (notePath) => this.getSceneReviewRecordByPath(notePath),
		shouldShowGuidedSweepHandoff: (session) => this.shouldShowGuidedSweepHandoff(session),
		getCurrentSessionTrackingContext: () => this.getCurrentSessionTrackingContext(),
		openReviewPanel: () => this.openReviewPanel(),
		revealSelectedSuggestion: () => this.revealSelectedSuggestion(),
		startOrResumeReviewForNote: (notePath) => this.startOrResumeReviewForNote(notePath),
		persistContributorProfilesIfNeeded: () => this.persistContributorProfilesIfNeeded(),
	});

	private readonly reviewActions = new ReviewActionsOrchestrator({
		store: this.store,
		registry: this.registry,
		workflow: this.workflow,
		getReviewStateMachine: () => this.getReviewStateMachine(),
		getReviewSession: () => this.getReviewSession(),
		getReviewNoteContext: () => this.getReviewNoteContext(),
		hasActiveReviewSession: () => this.hasActiveReviewSession(),
		hasReviewSessionContext: () => this.hasReviewSessionContext(),
		getSuggestionById: (id) => this.getSuggestionById(id),
		canApplyAndReviewSceneSuggestions: () => this.canApplyAndReviewSceneSuggestions(),
		canApplySuggestionInReviewAllMode: (s) => this.canApplySuggestionInReviewAllMode(s),
		isSweepComplete: (suggestions) => this.isSweepComplete(suggestions),
		getAdjacentRevealableSuggestionId: (dir) => this.getAdjacentRevealableSuggestionId(dir),
		getAdjacentAcceptedSuggestionId: (dir) => this.getAdjacentAcceptedSuggestionId(dir),
		getAdjacentCompletedReviewSuggestionId: (dir) => this.getAdjacentCompletedReviewSuggestionId(dir),
		getResolvedCompletedSweepState: () => this.getResolvedCompletedSweepState(),
		enterCompletedSweepAudit: () => this.enterCompletedSweepAudit(),
		getBulkApplyConfirmState: () => this.bulkApplyConfirmState,
		setBulkApplyConfirmState: (value) => {
			this.bulkApplyConfirmState = value;
		},
		setLastAppliedChange: (value) => {
			this.lastAppliedChange = value;
		},
		clearActiveHighlights: () => this.clearActiveHighlights(),
		setDefaultHighlightForSelection: () => this.setDefaultHighlightForSelection(),
		syncActiveEditorDecorations: () => this.syncActiveEditorDecorations(),
		refreshReviewPanel: () => this.refreshReviewPanel(),
		revealSelectedSuggestion: () => this.revealSelectedSuggestion(),
		revealSuggestionContext: (id) => this.revealSuggestionContext(id),
		focusResolvedTarget: (target) => this.focusResolvedTarget(target),
		focusEditorRange: (start, end) => this.focusEditorRange(start, end),
		closeReviewPanelLeaf: () => {
			this.app.workspace.detachLeavesOfType(REVIEW_PANEL_VIEW_TYPE);
		},
		dismissToolbar: () => this.toolbarOverlay.dismiss(),
		clearToolbarDismissedSignature: () => this.toolbarOverlay.clearDismissedSignature(),
	});

	async onload(): Promise<void> {
		await this.loadPluginData();
		await this.persistContributorProfilesIfNeeded();
		await this.registry.refreshActiveBookScope();
		this.importEngine = new ImportEngine(this.app, this.parser, this.matchEngine);
		this.pendingEdits.initialize();
		this.registerEditorExtension(createReviewDecorationsExtension());
		this.registerView(REVIEW_PANEL_VIEW_TYPE, (leaf) => new ReviewPanel(leaf, this));
		this.registerView(EDITORIALISM_PANEL_VIEW_TYPE, (leaf) => new EditorialismPanel(leaf, this));
		this.addSettingTab(new EditorialistSettingTab(this.app, this));
		this.addRibbonIcon("pen-tool", "Open review panel", () => {
			void this.openReviewPanel();
		});
		this.addRibbonIcon("list-checks", "Open Editorialism panel", () => {
			void this.openEditorialismPanel();
		});
		registerCommands(this);
		this.registerDomEvent(window, "resize", () => {
			this.toolbarOverlay.handleResize();
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
				void this.pendingEdits.refreshPendingEditsSummary();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				// Trailing-debounce because editor-change fires per-keystroke on
				// large manuscripts; the resync is idempotent so coalescing
				// bursts into a single trailing call preserves correctness while
				// removing the per-key cost. active-leaf-change and file-open
				// stay immediate — those are user-driven and rare.
				this.editorChangeResyncDebouncer.schedule();
			}),
		);

		this.syncActiveEditorDecorations();
		void this.pendingEdits.refreshPendingEditsSummary({ force: true });
	}

	async onunload(): Promise<void> {
		// Obsidian submission guideline: do NOT detach leaves of your own view type here —
		// Obsidian restores workspace state on reload, and registerView() already handles cleanup.
		this.toolbarOverlay.destroy();
		this.toolbarKeyTracker.dispose();
		this.editorChangeResyncDebouncer.cancel();
		this.pendingEdits.clearInquiryMaps();
		// Flush any debounced plugin-data save so pending changes (e.g. a star
		// toggle right before the user disables the plugin) are not lost.
		try {
			await this.flushPluginDataSave();
		} catch (err) {
			// console.error is the only diagnostic surface during unload — a
			// Notice would not be seen because the plugin is shutting down.
			// eslint-disable-next-line no-console
			console.error("Editorialist: failed to flush plugin data on unload", err);
		}
	}

	async parseCurrentNote(options?: { suppressNotice?: boolean }): Promise<void> {
		await this.sessionOrchestrator.parseCurrentNote(options);
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
			activeBookLabel: this.registry.getActiveBookScopeInfo().label,
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
				await this.batchProcessor.importReviewBatch(batch, startReview);
			},
			onImportRawToActiveNote: async (rawText, startReview) => {
				await this.batchProcessor.importReviewBatchToActiveNote(rawText, startReview);
			},
			onInspectBatch: async (rawText, correctedTargets) =>
				this.batchProcessor.inspectReviewBatch(rawText, {
					activeNotePath: context?.filePath,
					correctedTargets,
				}),
			onLoadClipboardBatch: async () => this.batchProcessor.loadClipboardReviewBatch(),
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
		void this.pendingEdits.refreshPendingEditsSummary({ force: true });
	}

	isReviewPanelOpen(): boolean {
		return this.app.workspace.getLeavesOfType(REVIEW_PANEL_VIEW_TYPE).length > 0;
	}

	async openEditorialismPanel(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(EDITORIALISM_PANEL_VIEW_TYPE);
		const [primary, ...duplicates] = existing;
		for (const duplicate of duplicates) {
			duplicate.detach();
		}
		const leaf = primary ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}
		await leaf.setViewState({
			type: EDITORIALISM_PANEL_VIEW_TYPE,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	getEditorialismFolder(): string {
		return this.editorialismService.getRootFolderName();
	}

	async listEditorialismsForActiveBook(bookLabel: string | null): Promise<
		Awaited<ReturnType<EditorialismService["listForBook"]>>
	> {
		return this.editorialismService.listForBook(bookLabel);
	}

	async loadEditorialism(filePath: string): Promise<
		Awaited<ReturnType<EditorialismService["load"]>>
	> {
		return this.editorialismService.load(filePath);
	}

	async setEditorialismItemStatus(
		filePath: string,
		lineIndex: number,
		nextStatus: Parameters<EditorialismService["setItemStatus"]>[2],
	): Promise<void> {
		await this.editorialismService.setItemStatus(filePath, lineIndex, nextStatus);
	}

	getPendingEditsSession(): PendingEditsSession | null {
		return this.pendingEdits.getPendingEditsSession();
	}

	getPendingEditsSummary(): PendingEditsSummary | null {
		return this.pendingEdits.getPendingEditsSummary();
	}

	hasPendingEditsForScene(scenePath: string): boolean {
		return this.pendingEdits.hasPendingEditsForScene(scenePath);
	}

	getPendingEditsCountForScene(scenePath: string): number {
		return this.pendingEdits.getPendingEditsCountForScene(scenePath);
	}

	async refreshPendingEditsSummary(options?: { force?: boolean }): Promise<void> {
		return this.pendingEdits.refreshPendingEditsSummary(options);
	}

	async startPendingEditsReview(): Promise<void> {
		await this.pendingEdits.startPendingEditsReview();
	}

	async startPendingEditsReviewForScene(scenePath: string): Promise<void> {
		await this.pendingEdits.startPendingEditsReviewForScene(scenePath);
	}

	async openPendingEditSegment(segment: PendingEditSegment): Promise<void> {
		await this.pendingEdits.openPendingEditSegment(segment);
	}

	async completePendingEditSegment(segment: PendingEditSegment): Promise<void> {
		await this.pendingEdits.completePendingEditSegment(segment);
	}

	async skipPendingEditSegment(segment: PendingEditSegment): Promise<void> {
		await this.pendingEdits.skipPendingEditSegment(segment);
	}

	async completeSelectedPendingEditSegment(): Promise<void> {
		await this.pendingEdits.completeSelectedPendingEditSegment();
	}

	async skipSelectedPendingEditSegment(): Promise<void> {
		await this.pendingEdits.skipSelectedPendingEditSegment();
	}

	async selectNextPendingEditSegment(): Promise<void> {
		await this.pendingEdits.selectNextPendingEditSegment();
	}

	async selectPreviousPendingEditSegment(): Promise<void> {
		await this.pendingEdits.selectPreviousPendingEditSegment();
	}

	async closePendingEditsReview(): Promise<void> {
		await this.pendingEdits.closePendingEditsReview();
	}

	openInquiryBriefNote(notePath: string): void {
		this.pendingEdits.openInquiryBriefNote(notePath);
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
		await this.reviewActions.selectSuggestion(id);
	}

	async selectNextSuggestion(): Promise<void> {
		await this.reviewActions.selectNextSuggestion();
	}

	async selectPreviousSuggestion(): Promise<void> {
		await this.reviewActions.selectPreviousSuggestion();
	}

	async selectNextAcceptedSuggestion(): Promise<void> {
		await this.reviewActions.selectNextAcceptedSuggestion();
	}

	async selectPreviousAcceptedSuggestion(): Promise<void> {
		await this.reviewActions.selectPreviousAcceptedSuggestion();
	}

	async exitAcceptedReviewMode(): Promise<void> {
		await this.reviewActions.exitAcceptedReviewMode();
	}

	async acceptSelectedSuggestion(): Promise<boolean> {
		return this.reviewActions.acceptSelectedSuggestion();
	}

	async acceptSelectedSuggestionAndAdvance(): Promise<void> {
		await this.reviewActions.acceptSelectedSuggestionAndAdvance();
	}

	async enterApplyAndReviewConfirmMode(): Promise<void> {
		await this.reviewActions.enterApplyAndReviewConfirmMode();
	}

	cancelApplyAndReviewConfirmMode(): void {
		this.reviewActions.cancelApplyAndReviewConfirmMode();
	}

	async confirmApplyAndReviewSceneSuggestions(): Promise<void> {
		await this.reviewActions.confirmApplyAndReviewSceneSuggestions();
	}

	async applyAndReviewSceneSuggestions(): Promise<void> {
		await this.reviewActions.applyAndReviewSceneSuggestions();
	}

	async selectNextAppliedReviewChange(): Promise<void> {
		await this.reviewActions.selectNextAppliedReviewChange();
	}

	async selectPreviousAppliedReviewChange(): Promise<void> {
		await this.reviewActions.selectPreviousAppliedReviewChange();
	}

	async exitAppliedReviewMode(): Promise<void> {
		await this.reviewActions.exitAppliedReviewMode();
	}

	async closeActiveReviewContext(): Promise<void> {
		await this.reviewActions.closeActiveReviewContext();
	}

	async closeReviewPanel(): Promise<void> {
		await this.reviewActions.closeReviewPanel();
	}

	async finishActiveReview(): Promise<void> {
		await this.reviewActions.finishActiveReview();
	}

	dismissReviewToolbar(): void {
		this.reviewActions.dismissReviewToolbar();
	}

	async continueGuidedSweep(): Promise<void> {
		await this.reviewActions.continueGuidedSweep();
	}

	async finishGuidedSweep(): Promise<void> {
		await this.reviewActions.finishGuidedSweep();
	}

	// Bridges the guided-sweep workflow to the per-scene polish counter
	// (Editorialist.revision in scene frontmatter — see
	// incrementSceneEditorialRevision for the full intent and gates).
	async recordCompletedSceneRevision(
		notePath: string,
		batchId: string,
	): Promise<{ from: number; to: number } | null> {
		// Gate 3: only bump when the user has actually closed all suggestions
		// for this scene. Abandoning mid-review must not advance the counter.
		const session = this.getReviewSession();
		if (session?.notePath === notePath && !this.isSweepComplete(session.suggestions)) {
			return null;
		}

		return this.registry.incrementSceneEditorialRevision(notePath, batchId);
	}

	async resumeCompletedReviewMode(): Promise<void> {
		await this.reviewActions.resumeCompletedReviewMode();
	}

	async selectNextCompletedReviewSuggestion(): Promise<void> {
		await this.reviewActions.selectNextCompletedReviewSuggestion();
	}

	async selectPreviousCompletedReviewSuggestion(): Promise<void> {
		await this.reviewActions.selectPreviousCompletedReviewSuggestion();
	}

	async exitCompletedReviewMode(): Promise<void> {
		await this.reviewActions.exitCompletedReviewMode();
	}

	async rejectSelectedSuggestion(): Promise<void> {
		await this.reviewActions.rejectSelectedSuggestion();
	}

	// TODO (RC follow-up — deferred this pass): rewrite capture. Today this
	// only sets status="rewritten" (counts DONE, never blocks completion,
	// shows "Rewritten by the author"). A later pass should optionally persist
	// { originalMatchedText, suggestedReplacement, authorReplacement,
	// timestamp } via a "Use my rewrite" / "Use selected text as rewrite"
	// flow. Also deferred: RT scene-inventory glyphs, contributor-management
	// redesign, advanced analytics/history.
	async rewriteSelectedSuggestion(): Promise<void> {
		await this.reviewActions.rewriteSelectedSuggestion();
	}

	deferSelectedSuggestion(): void {
		this.reviewActions.deferSelectedSuggestion();
	}

	getCutFolderOverride(): string {
		return this.registry.getCutFolderOverride();
	}

	async setCutFolderOverride(value: string): Promise<void> {
		this.registry.setCutFolderOverride(value);
		await this.savePluginData();
	}

	// "Backup to cut file" — a preservation-only utility. It copies the current
	// editor selection (or, as a fallback, a selected cut/condense suggestion's
	// resolved target) into the scene's cut file. It deliberately does NOT change
	// any suggestion status, sweep stats, or contributor metrics.
	async backupSelectionToCutFile(): Promise<void> {
		const resolved = this.resolveCutBackupSource();
		if (!resolved) {
			new Notice(
				"Select text in the editor, or choose a cut or condense suggestion, to back up to the cut file.",
			);
			return;
		}

		try {
			const result = await this.cutArchive.backup({
				sceneFile: resolved.sceneFile,
				text: resolved.text,
				source: resolved.source,
				scenePath: resolved.sceneFile.path,
				operation: resolved.operation,
				suggestionId: resolved.suggestionId,
				contributor: resolved.contributor,
				reason: resolved.reason,
				backedUpAtIso: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
			});
			const displayName = result.cutFilePath.split("/").pop() ?? result.cutFilePath;
			new Notice(`Backed up to ${displayName}.`);
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error("Editorialist: failed to back up text to cut file", error);
			new Notice("Could not write to the cut file. Check the cut folder path in settings.");
		}
	}

	// Resolves BOTH the text and the scene file it belongs to, so the two never
	// drift apart: a manual selection archives into the file the selection lives
	// in; a suggestion-target fallback archives into the suggestion's own scene
	// (the session note), never whatever happens to be the active markdown file.
	private resolveCutBackupSource(): {
		sceneFile: TFile;
		text: string;
		source: CutBackupSourceType;
		operation?: ReviewSuggestion["operation"];
		suggestionId?: string;
		contributor?: string;
		reason?: string;
	} | null {
		// 1. Live editor selection wins. Read it at action time (not from cached
		//    toolbar state) so a toolbar click that doesn't steal focus still sees
		//    the user's current selection, and archive into that file.
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const selection = view?.editor.getSelection();
		if (view?.file && selection && selection.trim()) {
			return { sceneFile: view.file, text: selection, source: "selection" };
		}

		// 2. Fall back to a selected shrink-style suggestion's resolved target,
		//    archiving into the suggestion's scene (the session note).
		const selected = this.store.getSelectedSuggestion();
		if (!selected || (selected.operation !== "cut" && selected.operation !== "condense")) {
			return null;
		}

		const session = this.getReviewSession();
		if (!session) {
			return null;
		}

		const sceneFile = this.app.vault.getAbstractFileByPath(session.notePath);
		if (!(sceneFile instanceof TFile)) {
			return null;
		}

		const text = this.resolveSuggestionTargetText(sceneFile, selected.location.target);
		if (!text) {
			return null;
		}

		return {
			sceneFile,
			text,
			source: "suggestion-target",
			operation: selected.operation,
			suggestionId: selected.id,
			contributor: selected.contributor.displayName,
			reason: selected.why,
		};
	}

	private resolveSuggestionTargetText(sceneFile: TFile, target: ReviewTargetRef | undefined): string | null {
		if (!target) {
			return null;
		}

		// Prefer the live manuscript slice by offsets (freshest wording); fall back
		// to the matched text captured on the target ref.
		const context = this.getNoteContextByPath(sceneFile.path);
		if (
			context &&
			target.startOffset !== undefined &&
			target.endOffset !== undefined &&
			target.endOffset > target.startOffset
		) {
			const slice = context.text.slice(target.startOffset, target.endOffset);
			if (slice.trim()) {
				return slice;
			}
		}

		return target.text.trim() ? target.text : null;
	}

	async jumpToSelectedSuggestionTarget(): Promise<void> {
		await this.reviewActions.jumpToSelectedSuggestionTarget();
	}

	async jumpToSelectedSuggestionAnchor(): Promise<void> {
		await this.reviewActions.jumpToSelectedSuggestionAnchor();
	}

	async jumpToSelectedSuggestionSource(): Promise<void> {
		await this.reviewActions.jumpToSelectedSuggestionSource();
	}

	private reviewStateMachineInstance: ReviewStateMachine | null = null;

	private getReviewStateMachine(): ReviewStateMachine {
		if (!this.reviewStateMachineInstance) {
			this.reviewStateMachineInstance = new ReviewStateMachine(this.createReviewStateMachineHost());
		}
		return this.reviewStateMachineInstance;
	}

	private createReviewStateMachineHost(): ReviewStateMachineHost {
		const plugin = this;
		return {
			store: {
				getSession: () => plugin.store.getSession(),
				getCompletedSweep: () => plugin.store.getCompletedSweep(),
				selectSuggestion: (suggestionId) => plugin.store.selectSuggestion(suggestionId),
				updateSuggestionStatus: (suggestionId, status) =>
					plugin.store.updateSuggestionStatus(suggestionId, status),
				setCompletedSweep: (value) => plugin.store.setCompletedSweep(value),
				setGuidedSweep: (value) => plugin.store.setGuidedSweep(value),
			},
			getSelectedSuggestionId: () => plugin.store.getState().selectedSuggestionId,
			getGuidedSweep: () => plugin.getGuidedSweep(),
			registry: {
				persistReviewDecision: (notePath, suggestion, status, options) =>
					plugin.registry.persistReviewDecision(notePath, suggestion, status, options),
				clearPersistedReviewDecision: (notePath, suggestion, options) =>
					plugin.registry.clearPersistedReviewDecision(notePath, suggestion, options),
				syncReviewerSignalsForSession: (session, options) =>
					plugin.registry.syncReviewerSignalsForSession(session as ReviewSession | null, options),
				syncSceneInventoryForSession: (session) =>
					plugin.registry.syncSceneInventoryForSession(session as ReviewSession | null),
			},
			getReviewNoteContext: () => plugin.getReviewNoteContext(),
			getActiveEditorView: () => plugin.getActiveEditorView(),
			focusReviewLeaf: (view) => plugin.focusReviewLeaf(view as MarkdownView),
			executeEditorUndo: () => runEditorUndo(this.app.workspace.getActiveViewOfType(MarkdownView)),
			notify: (message) => {
				new Notice(message);
			},
			canAcceptSuggestion: (suggestionId) => plugin.canAcceptSuggestion(suggestionId),
			canRejectSuggestion: (suggestionId) => plugin.canRejectSuggestion(suggestionId),
			canMarkSuggestionRewritten: (suggestionId) => plugin.canMarkSuggestionRewritten(suggestionId),
			hasActiveReviewSession: () => plugin.hasActiveReviewSession(),
			hasReviewSessionContext: () => plugin.hasReviewSessionContext(),
			getReviewSession: () => plugin.getReviewSession(),
			getSuggestionById: (suggestionId) => plugin.getSuggestionById(suggestionId),
			getCurrentSessionTrackingContext: () => plugin.getCurrentSessionTrackingContext(),
			getPanelOnlyReviewStateForSession: (session) =>
				plugin.getPanelOnlyReviewStateForSession(session as ReviewSession | null),
			revealSelectedSuggestion: () => plugin.revealSelectedSuggestion(),
			revealSuggestionContext: (suggestionId) => plugin.revealSuggestionContext(suggestionId),
			enterGuidedSweepHandoff: () => plugin.enterGuidedSweepHandoff(),
			refreshSessionAfterAcceptedEdit: (session, suggestionId) =>
				plugin.refreshSessionAfterAcceptedEdit(session as ReviewSession, suggestionId),
			syncActiveEditorDecorations: () => plugin.syncActiveEditorDecorations(),
			resyncSessionForActiveNote: () => plugin.resyncSessionForActiveNote(),
			focusResolvedTarget: async (target) => {
				await plugin.focusResolvedTarget(target as ReviewTargetRef | undefined);
			},
			get lastAppliedChange() {
				return plugin.lastAppliedChange;
			},
			set lastAppliedChange(value) {
				plugin.lastAppliedChange = value;
			},
			setActiveHighlight: (range, tone) => {
				plugin.activeHighlightRange = range;
				plugin.activeHighlightTone = tone ?? "active";
			},
		};
	}

	async acceptSuggestion(id: string): Promise<boolean> {
		return this.reviewActions.acceptSuggestion(id);
	}

	async rejectSuggestion(id: string): Promise<void> {
		await this.reviewActions.rejectSuggestion(id);
	}

	async markSuggestionRewritten(id: string): Promise<void> {
		await this.reviewActions.markSuggestionRewritten(id);
	}

	async deferSuggestion(id: string): Promise<void> {
		await this.reviewActions.deferSuggestion(id);
	}

	async undoLastAppliedSuggestion(): Promise<void> {
		await this.reviewActions.undoLastAppliedSuggestion();
	}

	async jumpToSuggestionTarget(id: string): Promise<void> {
		await this.reviewActions.jumpToSuggestionTarget(id);
	}

	async jumpToSuggestionAnchor(id: string): Promise<void> {
		await this.reviewActions.jumpToSuggestionAnchor(id);
	}

	async jumpToSuggestionSource(id: string): Promise<void> {
		await this.reviewActions.jumpToSuggestionSource(id);
	}

	getReviewerProfiles(): ContributorProfile[] {
		return this.reviewerDirectory.getProfiles();
	}

	getSortedReviewerProfiles(): ContributorProfile[] {
		return this.reviewerDirectory.getSortedProfiles();
	}

	getReviewerProfile(reviewerId?: string): ContributorProfile | null {
		return reviewerId ? this.reviewerDirectory.getProfileById(reviewerId) : null;
	}

	getReviewerStats(reviewerId?: string): ReviewerStats | null {
		return reviewerId ? this.reviewerDirectory.getStats(reviewerId) : null;
	}

	getSweepRegistryEntries(): ReviewSweepRegistryEntry[] {
		return this.registry.getSweepRegistryEntries();
	}

	// Aggregates per-suggestion decisions across scenes that participated in a
	// given sweep batch. Exact when each touched scene has only seen this one
	// batch (the common case); approximate when scenes are shared across
	// batches — in that case counts are the union, which is acceptable for the
	// at-a-glance Recent Reviews display.
	getBatchDecisionStats(batchId: string): {
		accepted: number;
		rejected: number;
		rewritten: number;
		deferred: number;
	} {
		return this.registry.getBatchDecisionStats(batchId);
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
		return this.batchProcessor.resetBatchHistory(batchId);
	}

	async resetAllRevisionHistory(): Promise<{ removedDecisions: number; removedSignals: number; removedSweeps: number }> {
		const result = await this.registry.resetAllRevisionHistory();
		await this.closeActiveReviewContext();
		this.store.batch(() => {
			this.store.setGuidedSweep(null);
			this.store.acknowledgeCompletedSweep(null);
		});
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
	} {
		const session = this.store.getSession();
		if (!session) {
			return {
				summary: "",
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

		const activeBookCandidate = this.getSceneReviewRecords({ activeBookOnly: true }).find((record) =>
			this.isSweepableSceneRecord(record),
		);
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
		// Once a sweep is cleaned, the review blocks are gone from the notes —
		// "Review changes" cannot re-enter audit mode (no live data), and
		// "Clean review blocks" has nothing left to remove. Show only the
		// forward-looking action (import) and the close link.
		const isCleaned = entry?.status === "cleaned";
		const nextSteps: CompletedSweepPanelState["nextSteps"] = [];
		if (!isCleaned) {
			nextSteps.push({ action: "start", label: "Review changes" });
		}
		nextSteps.push({ action: "import", label: "Import new revision notes" });
		if (!isCleaned && (entry?.importedNotePaths.length ?? 0) > 0) {
			nextSteps.push({ action: "clean", label: "Clean review blocks" });
		}

		// End-of-batch reminder: if the scene the reviewer just finished still
		// carries pending edits (human notes / inquiry items), offer to address
		// them right here rather than leaving them for a separate book-wide pass.
		const activeScenePath = this.getReviewNoteContext()?.filePath ?? this.app.workspace.getActiveFile()?.path;
		const activeScenePendingCount = activeScenePath
			? this.getPendingEditsCountForScene(activeScenePath)
			: 0;
		if (activeScenePath && activeScenePendingCount > 0) {
			nextSteps.push({
				action: "pending",
				label: `Address ${activeScenePendingCount} pending edit${activeScenePendingCount === 1 ? "" : "s"} in this scene`,
				scenePath: activeScenePath,
			});
		}

		return {
			closeLabel: "Close review",
			title: "All revisions complete",
			editsReviewedLabel: `${completedSweep.totalSuggestions} edit${completedSweep.totalSuggestions === 1 ? "" : "s"} reviewed across ${completedSweep.notePaths.length} ${unitLabel}`,
			description: isCleaned
				? "Review blocks have been removed from your notes. Import a new revision pass when you're ready."
				: "You've finished this revision pass.",
			durationLabel: this.getCompletedSweepDurationLabel(completedSweep),
			nextSteps,
		};
	}

	getReviewStateOverview(): ReviewStateOverview | null {
		const records = this.getSceneReviewRecords({ activeBookOnly: true }).filter(
			(record) => record.batchCount > 0 && record.status !== "cleaned",
		);
		if (records.length === 0) {
			return null;
		}

		const pending: ReviewStateIndexEntry[] = [];
		const processed: ReviewStateIndexEntry[] = [];

		for (const record of records) {
			const entry: ReviewStateIndexEntry = {
				notePath: record.notePath,
				noteTitle: record.noteTitle,
				sceneId: record.sceneId,
				pendingCount: record.pendingCount + record.unresolvedCount,
				deferredCount: record.deferredCount,
				processedCount: record.acceptedCount + record.rejectedCount + record.rewrittenCount,
				lastUpdated: record.lastUpdated,
			};

			if (record.status === "in_progress" || entry.pendingCount > 0 || entry.deferredCount > 0) {
				pending.push(entry);
			} else {
				processed.push(entry);
			}
		}

		if (pending.length === 0 && processed.length === 0) {
			return null;
		}

		return { pending, processed };
	}

	getPostCompletionIdleState(): PostCompletionIdleState | null {
		const activeSceneRecords = this.getSceneReviewRecords().filter((record) => record.batchCount > 0);
		if (activeSceneRecords.length === 0) {
			return {
				title: "Editorialist review",
				description:
					"Editorialist reviews two kinds of revision work: imported review notes and PENDING EDITS notes across the active book.",
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
				"Editorialist reviews two kinds of revision work: imported review notes and PENDING EDITS notes across the active book.",
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
		return this.sessionOrchestrator.hasCurrentLastAppliedChangeForContext(context);
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
			this.sessionOrchestrator.hasCurrentLastAppliedChangeForContext(context) &&
			change.suggestionId === selectedId,
		);
	}

	getSuggestionPresentationTone(suggestion: ReviewSuggestion): "active" | "muted" {
		return getSuggestionPresentationTone(suggestion);
	}

	getAppliedReviewState(): AppliedReviewState | null {
		return this.store.getAppliedReview();
	}

	// Public read-through facades for the panel UI. The store itself is private
	// to the plugin — external callers go through these getters so that store
	// mutations remain owned by the plugin/state-machine path.
	getCurrentReviewSession(): ReviewSession | null {
		return this.store.getSession();
	}

	getSelectedSuggestionId(): string | null {
		return this.store.getState().selectedSuggestionId;
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

	// Workspace-aware open-note text resolver injected into
	// ReviewRegistryService so the service stays at the vault/persistence
	// layer and never reaches `app.workspace` directly. Mirrors the original
	// private helper that lived inside the service; the search is unchanged.
	private resolveOpenNoteText(notePath: string): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as { file?: { path?: string }; editor?: { getValue: () => string } };
			if (view.file?.path !== notePath || !view.editor) {
				continue;
			}

			return view.editor.getValue();
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
		const session = this.getReviewSession();
		const selected = this.store.getSelectedSuggestion();

		let review: ReviewBranchInputs | null = null;
		if (session && selected) {
			const suggestions = session.suggestions;
			const guidedSweep = this.getGuidedSweep();
			const unitLabel = this.getSweepUnitLabel(guidedSweep?.notePaths.length ?? 0, session.notePath);
			const sceneProgressLabel =
				guidedSweep && guidedSweep.notePaths.length > 1
					? `${this.toTitleCase(unitLabel.slice(0, -1))} ${guidedSweep.currentNoteIndex + 1} of ${guidedSweep.notePaths.length}`
					: undefined;
			review = {
				hasReviewBlock,
				selectedIndex: suggestions.findIndex((suggestion) => suggestion.id === selected.id),
				suggestionsLength: suggestions.length,
				effectiveStatuses: suggestions.map((suggestion) => this.getEffectiveSuggestionStatus(suggestion)),
				anchorDirection: this.getActiveMoveAnchorDirection(selected),
				sweepComplete: this.isSweepComplete(suggestions),
				sceneProgressLabel,
				canApply: this.canAcceptSelectedSuggestion(),
				canDefer: this.canDeferSelectedSuggestion(),
				canRewrite: this.canRewriteSelectedSuggestion(),
				canReject: this.canRejectSelectedSuggestion(),
				canNext: this.getAdjacentRevealableSuggestionId("next") !== null,
				canPrevious: this.getAdjacentRevealableSuggestionId("previous") !== null,
				canUndoLastAccept: this.shouldShowUndoForSelectedSuggestion(selected.id),
				operation: selected.operation,
				operationLabel: selected.operation.toUpperCase(),
			};
		}

		const appliedReview = this.store.getAppliedReview();
		const inputs: ToolbarStateInputs = {
			pendingEditsToolbarState: this.pendingEdits.getPendingEditsToolbarState(),
			hasReviewBlock,
			hasSession: session !== null,
			sessionNotePath: session?.notePath ?? null,
			appliedReview: appliedReview
				? { currentIndex: appliedReview.currentIndex, entryCount: appliedReview.entries.length }
				: null,
			completedReviewPreview: this.getCompletedReviewPreviewState(session),
			completedReviewCanNext: this.getAdjacentCompletedReviewSuggestionId("next") !== null,
			completedReviewCanPrevious: this.getAdjacentCompletedReviewSuggestionId("previous") !== null,
			hasLastAppliedChange: Boolean(this.lastAppliedChange),
			canUndoLastAppliedSuggestion: this.canUndoLastAppliedSuggestion(),
			acceptedReviewPreview: this.getAcceptedReviewPreviewState(session),
			acceptedReviewCanNext: this.getAdjacentAcceptedSuggestionId("next") !== null,
			acceptedReviewCanPrevious: this.getAdjacentAcceptedSuggestionId("previous") !== null,
			sessionHasNoOpenWork: session ? !this.hasLiveActionableSuggestions(session.suggestions) : false,
			guidedSweepHandoff: this.getGuidedSweepHandoffState(),
			panelOnly: this.getPanelOnlyReviewStateForSession(session),
			hasSelectedSuggestion: selected !== null,
			bulkApplyConfirmNotePath: this.bulkApplyConfirmState?.notePath ?? null,
			canApplyAndReviewSceneSuggestions: this.canApplyAndReviewSceneSuggestions(),
			bulkApplicableCount: session
				? session.suggestions.filter((suggestion) => this.canApplySuggestionInReviewAllMode(suggestion)).length
				: 0,
			review,
		};

		return buildToolbarState(inputs);
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
			this.toolbarOverlay.destroy();
			return;
		}

		const hasReviewBlock = noteContainsReviewBlock(context.text);
		const highlight = this.hasReviewSessionContext() ? this.activeHighlightRange : null;
		const toolbarState = this.getToolbarState(hasReviewBlock);

		syncReviewDecorations(editorView, this.getReviewDecorationSnapshot(highlight));
		this.toolbarOverlay.sync(editorView, toolbarState, highlight);
	}

	private resyncSessionForActiveNote(): void {
		this.sessionOrchestrator.resyncSessionForActiveNote();
	}

	private refreshSessionAfterAcceptedEdit(session: ReviewSession, acceptedSuggestionId: string): void {
		this.sessionOrchestrator.refreshSessionAfterAcceptedEdit(session, acceptedSuggestionId);
	}

	private getSuggestionById(id: string): ReviewSuggestion | null {
		const session = this.store.getSession();
		return session?.suggestions.find((suggestion) => suggestion.id === id) ?? null;
	}

	private applyReviewerResolutionToMatchingSuggestions(
		raw: ParsedContributorReference,
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
		raw: ParsedContributorReference,
		profile: ContributorProfile,
		resolutionStatus: ReviewerResolutionStatus,
	): Promise<void> {
		const contributor = this.createResolvedContributor(raw, profile, resolutionStatus);
		return this.applyContributorToMatchingSuggestions(raw, contributor);
	}

	private async applyContributorToMatchingSuggestions(raw: ParsedContributorReference, contributor: ReviewSuggestion["contributor"]): Promise<void> {
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
		raw: ParsedContributorReference,
		profile: ContributorProfile,
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

	private reassignContributorInActiveSession(sourceReviewerId: string, targetProfile: ContributorProfile): void {
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

	private syncContributorProfileInActiveSession(profile: ContributorProfile): void {
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
		raw: ParsedContributorReference,
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

	private sameRawReviewer(left: ParsedContributorReference, right: ParsedContributorReference): boolean {
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
		return canRevealSuggestionInManuscriptShared(suggestion);
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

		return getAdjacentRevealableSuggestionIdShared(
			session.suggestions,
			this.store.getState().selectedSuggestionId,
			direction,
			{ fromId, treatCurrentAsDeferred },
		);
	}

	private shouldShowGuidedSweepHandoff(session?: ReviewSession | null): boolean {
		const targetSession = session ?? this.getReviewSession();
		return Boolean(this.getGuidedSweep() && targetSession && !this.hasLiveActionableSuggestions(targetSession.suggestions));
	}

	private hasLiveActionableSuggestions(suggestions: ReviewSuggestion[]): boolean {
		return hasLiveActionableSuggestionsShared(suggestions);
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
			description: `More notes further down ${unitLabel === "scene" ? "this scene" : "this note"}.`,
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
		return isSweepCompleteShared(suggestions);
	}

	private isSuggestionOpen(suggestion: ReviewSuggestion): boolean {
		return isSuggestionOpenShared(suggestion);
	}

	private getEffectiveSuggestionStatus(suggestion: ReviewSuggestion): ReviewSuggestion["status"] {
		return getEffectiveSuggestionStatusShared(suggestion);
	}

	private isAcceptedReviewSuggestion(suggestion: ReviewSuggestion): boolean {
		return suggestion.status === "accepted" && this.hasRevealableAcceptedRange(suggestion);
	}


	private getNoteTextFingerprint(text: string): string {
		return computeNoteTextFingerprint(text);
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

	private async enterGuidedSweepHandoff(): Promise<void> {
		this.store.batch(() => {
			this.store.setAppliedReview(null);
			this.store.selectSuggestion(null);
		});
		this.clearActiveHighlights();
		this.syncActiveEditorDecorations();
	}

	private async enterCompletedSweepAudit(): Promise<void> {
		const completedSweep = this.getResolvedCompletedSweepState();
		if (completedSweep && !this.store.getCompletedSweep()) {
			this.store.setCompletedSweep(completedSweep);
		}

		await this.sessionOrchestrator.ensureCompletedSweepAuditSession();
		this.store.setAppliedReview(null);
		const suggestionId = this.getAdjacentCompletedReviewSuggestionId("next");
		this.store.selectSuggestion(suggestionId);
		await this.revealSelectedSuggestion();
	}

	private getResolvedCompletedSweepState(): CompletedSweepState | null {
		const completedSweep = this.store.getCompletedSweep();
		if (completedSweep) {
			return completedSweep;
		}

		if (this.store.getGuidedSweep()) {
			return null;
		}

		// Per-session completion is independent of other scenes' state: when the
		// user closes out every suggestion in the active session, advance to the
		// completion card immediately even if unrelated batches in other scenes
		// still have pending work. Without this, single-scene reviews never wrap.
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

		const remainingCount = this.getSceneReviewRecords()
			.filter((record) => record.batchCount > 0)
			.reduce((total, record) => total + record.pendingCount + record.unresolvedCount + record.deferredCount, 0);
		if (remainingCount > 0) {
			return null;
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
		this.toolbarOverlay.scheduleReposition();
	}

	private async focusReviewLeaf(view: MarkdownView): Promise<void> {
		const leaf = this.app.workspace.getLeavesOfType("markdown").find((candidate) => candidate.view === view);
		if (!leaf) {
			return;
		}

		await this.app.workspace.setActiveLeaf(leaf, false, true);
		this.app.workspace.revealLeaf(leaf);
	}

	private async loadPluginData(): Promise<void> {
		const rawSavedData = (await this.loadData()) as unknown;
		const savedData = migratePluginData(rawSavedData);
		this.registry.load(savedData);
		this.reviewerDirectory.setProfiles(savedData.reviewerProfiles);
		this.registry.rebuildReviewerStatsFromSignals();
	}

	// Trailing-debounce around saveData() so bursty workflows (batch import,
	// bulk reviewer reassignment, rapid star toggles) coalesce into a single
	// JSON write. Callers still await savePluginData() and get a promise that
	// resolves only after the write that covers their request completes.
	private readonly pluginDataSaver = new DebouncedSaver(
		() => this.saveData(this.registry.buildPluginData(this.reviewerDirectory.getProfiles())),
		300,
	);

	// Coalesces per-keystroke editor-change events into a single trailing
	// resync. 120ms keeps the response feeling immediate while folding even
	// fast typing into one batch. Cancelled in onunload — running a resync
	// against torn-down state is pointless and risks stale references.
	private readonly editorChangeResyncDebouncer = new TrailingDebouncer(
		() => this.resyncSessionForActiveNote(),
		120,
	);

	private async savePluginData(): Promise<void> {
		await this.pluginDataSaver.request();
	}

	async flushPluginDataSave(): Promise<void> {
		await this.pluginDataSaver.flush();
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

		await this.sessionOrchestrator.parseReviewContext(context, true);
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

	private async copyReviewTemplateToClipboard(selectedText?: string): Promise<void> {
		const context = this.gatherReviewTemplateContext();
		const template = buildReviewTemplate(selectedText, context);
		await this.copyTextToClipboard(template, "Review template copied", "Could not copy the review template.");
	}

	// Collects the active book label, the active note's scene id (if any), and
	// the full list of scene ids in the active book — so the copied prompt can
	// give the AI a concrete set of valid SceneIds. Without this, AIs invent
	// plausible-looking ids (e.g. `scn_eb08b7ef`) that fail to route.
	private gatherReviewTemplateContext(): ReviewTemplateContext {
		const scope = this.registry.getActiveBookScopeInfo();
		const activeFile = this.app.workspace.getActiveFile();
		const sceneIds: { id: string; title: string }[] = [];
		let activeSceneId: string | null = null;

		if (scope.sourceFolder) {
			const seenIds = new Set<string>();
			for (const file of this.app.vault.getMarkdownFiles()) {
				if (!isPathInFolderScope(file.path, scope.sourceFolder)) {
					continue;
				}
				if (!isSceneClassFile(this.app, file)) {
					continue;
				}
				const sceneId = getSceneIdForFile(this.app, file);
				if (!sceneId || seenIds.has(sceneId)) {
					continue;
				}
				seenIds.add(sceneId);
				sceneIds.push({ id: sceneId, title: file.basename });
			}
			sceneIds.sort((left, right) => left.title.localeCompare(right.title, undefined, { numeric: true }));
		}

		if (activeFile) {
			activeSceneId = getSceneIdForFile(this.app, activeFile) ?? null;
		}

		return {
			bookLabel: scope.label,
			activeSceneId,
			sceneIds,
		};
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

	private async persistContributorProfilesIfNeeded(): Promise<void> {
		if (!this.reviewerDirectory.consumeDidChange()) {
			return;
		}

		await this.savePluginData();
	}

	async cleanupCurrentReviewBatch(): Promise<void> {
		await this.batchProcessor.cleanupCurrentReviewBatch();
	}

	async cleanupReviewBatchById(batchId: string): Promise<void> {
		await this.batchProcessor.cleanupReviewBatchById(batchId);
	}

	async cleanupCompletedSweepReviewBlocks(): Promise<void> {
		await this.batchProcessor.cleanupCompletedSweepReviewBlocks();
	}

	async removeImportedReviewBlocksInCurrentNote(): Promise<void> {
		await this.batchProcessor.removeImportedReviewBlocksInCurrentNote();
	}
}
