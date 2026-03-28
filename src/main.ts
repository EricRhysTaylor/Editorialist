import type { EditorView } from "@codemirror/view";
import { MarkdownView, Notice, Plugin } from "obsidian";
import { registerCommands } from "./commands/Commands";
import { MatchEngine } from "./core/MatchEngine";
import { ReviewEngine } from "./core/ReviewEngine";
import { SuggestionParser } from "./core/SuggestionParser";
import type { ReviewSession, ReviewSuggestion, ReviewTargetRef } from "./models/ReviewSuggestion";
import type {
	EditorialistPluginData,
	ParsedReviewerReference,
	ReviewerProfile,
	ReviewerResolutionStatus,
	ReviewerSignalRecord,
	ReviewerStats,
} from "./models/ReviewerProfile";
import { ReviewStore } from "./state/ReviewStore";
import { ReviewerDirectory } from "./state/ReviewerDirectory";
import { REVIEW_PANEL_VIEW_TYPE, ReviewPanel } from "./ui/ReviewPanel";
import { createReviewDecorationsExtension, syncReviewDecorations } from "./ui/Decorations";
import type { ToolbarState } from "./ui/Toolbar";

interface ActiveNoteContext {
	filePath: string;
	text: string;
	view: MarkdownView;
}

interface OffsetRange {
	end: number;
	start: number;
}

export default class EditorialistPlugin extends Plugin {
	readonly store = new ReviewStore();

	private readonly reviewerDirectory = new ReviewerDirectory();
	private readonly parser = new SuggestionParser(this.reviewerDirectory);
	private readonly matchEngine = new MatchEngine();
	private readonly reviewEngine = new ReviewEngine(this.parser, this.matchEngine);

	private activeHighlightRange: OffsetRange | null = null;
	private pluginData: EditorialistPluginData = {
		reviewerProfiles: [],
		reviewerSignalIndex: {},
	};

	async onload(): Promise<void> {
		await this.loadPluginData();
		this.registerEditorExtension(createReviewDecorationsExtension(this));
		this.registerView(REVIEW_PANEL_VIEW_TYPE, (leaf) => new ReviewPanel(leaf, this));
		registerCommands(this);

		const unsubscribe = this.store.subscribe(() => {
			this.refreshReviewPanel();
			this.syncActiveEditorDecorations();
		});
		this.register(unsubscribe);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.resyncSessionForActiveNote();
				this.syncActiveEditorDecorations();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				this.resyncSessionForActiveNote();
				this.syncActiveEditorDecorations();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				this.resyncSessionForActiveNote();
			}),
		);

		this.syncActiveEditorDecorations();
	}

	async onunload(): Promise<void> {
		this.app.workspace.detachLeavesOfType(REVIEW_PANEL_VIEW_TYPE);
	}

	async parseCurrentNote(): Promise<void> {
		const context = this.getActiveNoteContext();
		if (!context) {
			new Notice("No active markdown note to review.");
			return;
		}

		const previousSession = this.store.getSession();
		const preferredSelectionId =
			previousSession?.notePath === context.filePath ? this.store.getState().selectedSuggestionId : null;
		const session = this.reviewEngine.buildSession(
			context.filePath,
			context.text,
			previousSession?.notePath === context.filePath ? previousSession : null,
		);

		if (!session.hasReviewBlock) {
			this.activeHighlightRange = null;
			this.store.clearSession();
			new Notice("No rt-review fenced block found in the current note.");
			return;
		}

		this.store.setSession(session, preferredSelectionId);
		await this.syncReviewerSignalsForSession(session);
		await this.openReviewPanel();
		this.revealSelectedSuggestion();
		new Notice(
			session.suggestions.length > 0
				? `Parsed ${session.suggestions.length} review suggestion${session.suggestions.length === 1 ? "" : "s"}.`
				: "Review block found, but no valid review entries were parsed.",
		);
	}

	async openReviewPanel(): Promise<void> {
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}

		await leaf.setViewState({
			type: REVIEW_PANEL_VIEW_TYPE,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
		this.refreshReviewPanel();
	}

	async selectSuggestion(id: string): Promise<void> {
		if (!this.isActiveSessionForCurrentNote()) {
			return;
		}

		this.store.selectSuggestion(id);
		this.revealSuggestionContext(id);
	}

	async selectNextSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		this.store.selectNextSuggestion();
		this.revealSelectedSuggestion();
	}

	async selectPreviousSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		this.store.selectPreviousSuggestion();
		this.revealSelectedSuggestion();
	}

	async acceptSelectedSuggestion(): Promise<void> {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.acceptSuggestion(selectedSuggestion.id);
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

	async acceptSuggestion(id: string): Promise<void> {
		const context = this.getActiveNoteContext();
		const session = this.store.getSession();
		const suggestion = this.getSuggestionById(id);

		if (!context || !session || session.notePath !== context.filePath || !suggestion) {
			new Notice("The active note does not match the current review session.");
			return;
		}

		if (!this.canAcceptSuggestion(id)) {
			new Notice("This suggestion cannot be safely accepted yet.");
			return;
		}

		if (suggestion.operation === "move") {
			const updatedText = this.applyMoveSuggestion(context.text, suggestion);
			if (!updatedText) {
				new Notice("The move suggestion could not be applied safely.");
				return;
			}

			context.view.editor.setValue(updatedText);
		} else {
			if (
				!suggestion.revised ||
				suggestion.manuscriptMatch?.startOffset === undefined ||
				suggestion.manuscriptMatch.endOffset === undefined
			) {
				new Notice("The replace suggestion could not be applied safely.");
				return;
			}

			const from = context.view.editor.offsetToPos(suggestion.manuscriptMatch.startOffset);
			const to = context.view.editor.offsetToPos(suggestion.manuscriptMatch.endOffset);
			context.view.editor.replaceRange(suggestion.revised, from, to);
		}

		this.refreshSessionAfterAcceptedEdit(session, suggestion.id);
		await this.syncReviewerSignalsForSession(this.store.getSession());
		this.store.selectNextSuggestion(suggestion.id);
		this.revealSelectedSuggestion();
		new Notice("Suggestion accepted.");
	}

	async rejectSuggestion(id: string): Promise<void> {
		if (!this.canRejectSuggestion(id)) {
			return;
		}

		this.store.updateSuggestionStatus(id, "rejected");
		await this.syncReviewerSignalsForSession(this.store.getSession());
		this.store.selectNextSuggestion(id);
		this.revealSelectedSuggestion();
		new Notice("Suggestion rejected.");
	}

	skipSuggestion(id: string): void {
		if (!this.hasActiveReviewSession()) {
			return;
		}

		this.store.selectNextSuggestion(id);
		this.revealSelectedSuggestion();
	}

	async jumpToSuggestionTarget(id: string): Promise<void> {
		if (!this.isActiveSessionForCurrentNote()) {
			return;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion) {
			return;
		}

		this.store.selectSuggestion(id);
		const target = suggestion.operation === "move" ? suggestion.target : suggestion.manuscriptMatch;
		this.focusResolvedTarget(target);
	}

	async jumpToSuggestionAnchor(id: string): Promise<void> {
		if (!this.isActiveSessionForCurrentNote()) {
			return;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion?.anchor) {
			return;
		}

		this.store.selectSuggestion(id);
		this.focusResolvedTarget(suggestion.anchor);
	}

	async jumpToSuggestionSource(id: string): Promise<void> {
		if (!this.isActiveSessionForCurrentNote()) {
			return;
		}

		const suggestion = this.getSuggestionById(id);
		const start = suggestion?.source.startOffset;
		const end = suggestion?.source.endOffset;
		if (!suggestion || start === undefined || end === undefined) {
			return;
		}

		this.store.selectSuggestion(id);
		this.focusEditorRange(start, end);
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
		if (!this.isActiveSessionForCurrentNote()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion || suggestion.status !== "pending") {
			return false;
		}

		if (suggestion.operation === "move") {
			return Boolean(suggestion.relocation?.canApply);
		}

		return Boolean(
			suggestion.manuscriptMatch &&
				suggestion.manuscriptMatch.matchType === "exact" &&
				suggestion.manuscriptMatch.startOffset !== undefined &&
				suggestion.manuscriptMatch.endOffset !== undefined &&
				suggestion.revised,
		);
	}

	canAcceptSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canAcceptSuggestion(selected.id) : false;
	}

	canRejectSuggestion(id: string): boolean {
		if (!this.isActiveSessionForCurrentNote()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return Boolean(suggestion && suggestion.status !== "accepted" && suggestion.status !== "rejected");
	}

	canRejectSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canRejectSuggestion(selected.id) : false;
	}

	canJumpToSuggestionTarget(id: string): boolean {
		if (!this.isActiveSessionForCurrentNote()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion) {
			return false;
		}

		const target = suggestion.operation === "move" ? suggestion.target : suggestion.manuscriptMatch;
		return this.hasResolvedRange(target);
	}

	canJumpToSuggestionAnchor(id: string): boolean {
		if (!this.isActiveSessionForCurrentNote()) {
			return false;
		}

		return this.hasResolvedRange(this.getSuggestionById(id)?.anchor);
	}

	canJumpToSuggestionSource(id: string): boolean {
		if (!this.isActiveSessionForCurrentNote()) {
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
			return null;
		}

		return {
			filePath: file.path,
			text: view.editor.getValue(),
			view,
		};
	}

	private getActiveEditorView(): EditorView | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			return null;
		}

		// @ts-expect-error Obsidian exposes the CM6 instance at runtime but does not type it.
		return view.editor.cm as EditorView;
	}

	private getToolbarState(hasReviewBlock: boolean): ToolbarState | null {
		if (!hasReviewBlock) {
			return null;
		}

		const session = this.getActiveSessionForCurrentNote();
		const suggestions = session?.suggestions ?? [];

		return {
			hasReviewBlock,
			pendingCount: suggestions.filter((suggestion) => suggestion.status === "pending").length,
			unresolvedCount: suggestions.filter((suggestion) => suggestion.status === "unresolved").length,
			canAccept: this.canAcceptSelectedSuggestion(),
			canReject: this.canRejectSelectedSuggestion(),
		};
	}

	private syncActiveEditorDecorations(): void {
		const editorView = this.getActiveEditorView();
		const context = this.getActiveNoteContext();
		if (!editorView || !context) {
			return;
		}

		const hasReviewBlock = /```rt-review\b/i.test(context.text);
		const highlight = this.isActiveSessionForCurrentNote() ? this.activeHighlightRange : null;

		syncReviewDecorations(editorView, {
			highlight,
			toolbar: this.getToolbarState(hasReviewBlock),
		});
	}

	private resyncSessionForActiveNote(): void {
		const context = this.getActiveNoteContext();
		const session = this.store.getSession();
		if (!context || !session || session.notePath !== context.filePath) {
			this.activeHighlightRange = null;
			return;
		}

		const refreshedSession = this.reviewEngine.buildSession(context.filePath, context.text, session);
		if (!refreshedSession.hasReviewBlock) {
			this.activeHighlightRange = null;
			this.store.clearSession();
			return;
		}

		this.store.setSession(refreshedSession, this.store.getState().selectedSuggestionId);
		void this.syncReviewerSignalsForSession(refreshedSession);
		this.setDefaultHighlightForSelection();
	}

	private refreshSessionAfterAcceptedEdit(session: ReviewSession, acceptedSuggestionId: string): void {
		const context = this.getActiveNoteContext();
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

	private applyMoveSuggestion(noteText: string, suggestion: ReviewSuggestion): string | null {
		if (!suggestion.target?.text || !suggestion.relocation?.canApply) {
			return null;
		}

		const { targetStart, targetEnd, anchorStart, anchorEnd } = suggestion.relocation;
		if (
			targetStart === undefined ||
			targetEnd === undefined ||
			anchorStart === undefined ||
			anchorEnd === undefined ||
			!suggestion.placement
		) {
			return null;
		}

		const targetText = noteText.slice(targetStart, targetEnd);
		if (targetText !== suggestion.target.text) {
			return null;
		}

		const removedLength = targetEnd - targetStart;
		const withoutTarget = noteText.slice(0, targetStart) + noteText.slice(targetEnd);
		let adjustedAnchorStart = anchorStart;
		let adjustedAnchorEnd = anchorEnd;

		if (targetStart < anchorStart) {
			adjustedAnchorStart -= removedLength;
			adjustedAnchorEnd -= removedLength;
		}

		const insertOffset = suggestion.placement === "before" ? adjustedAnchorStart : adjustedAnchorEnd;
		return withoutTarget.slice(0, insertOffset) + targetText + withoutTarget.slice(insertOffset);
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
		await this.syncReviewerSignalsForSession(this.store.getSession());
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
			provider: profile.provider,
			model: profile.model,
			reviewerId: profile.id,
			resolutionStatus,
			suggestedReviewerIds: [],
			raw,
		};
	}

	private createUnresolvedContributor(
		raw: ParsedReviewerReference,
		suggestedReviewerIds: string[],
	): ReviewSuggestion["contributor"] {
		return {
			id: raw.rawName ? `parsed-${this.reviewerDirectory.normalizeValue(raw.rawName).replace(/\s+/g, "-")}` : "parsed-unknown-reviewer",
			displayName: raw.rawName?.trim() || "Unknown reviewer",
			kind: this.parseReviewerKind(raw.rawType),
			provider: raw.rawProvider?.trim() || undefined,
			model: raw.rawModel?.trim() || undefined,
			reviewerId: undefined,
			resolutionStatus: "unresolved",
			suggestedReviewerIds,
			raw,
		};
	}

	private async syncReviewerSignalsForSession(session: ReviewSession | null): Promise<void> {
		if (!session) {
			return;
		}

		let didChange = false;
		const nextIndex = {
			...this.pluginData.reviewerSignalIndex,
		};

		for (const suggestion of session.suggestions) {
			const key = this.createReviewerSignalKey(session.notePath, suggestion);
			const existingRecord = nextIndex[key];
			const desiredRecord = this.createReviewerSignalRecord(key, suggestion);

			if (this.sameReviewerSignalRecord(existingRecord, desiredRecord)) {
				continue;
			}

			if (existingRecord) {
				this.applyReviewerSignalDelta(existingRecord, -1);
				delete nextIndex[key];
				didChange = true;
			}

			if (desiredRecord) {
				this.applyReviewerSignalDelta(desiredRecord, 1);
				nextIndex[key] = desiredRecord;
				didChange = true;
			}
		}

		if (didChange) {
			this.pluginData.reviewerSignalIndex = nextIndex;
			await this.savePluginData();
			this.refreshReviewPanel();
		}
	}

	private createReviewerSignalKey(notePath: string, suggestion: ReviewSuggestion): string {
		return [
			notePath,
			suggestion.source.blockIndex,
			suggestion.source.entryIndex,
			suggestion.operation,
			suggestion.original ?? "",
			suggestion.revised ?? "",
			suggestion.target?.text ?? "",
			suggestion.anchor?.text ?? "",
			suggestion.placement ?? "",
		].join("::");
	}

	private createReviewerSignalRecord(key: string, suggestion: ReviewSuggestion): ReviewerSignalRecord | null {
		const reviewerId = suggestion.contributor.reviewerId;
		if (!reviewerId) {
			return null;
		}

		return {
			key,
			reviewerId,
			status: suggestion.status === "accepted" ? "accepted" : suggestion.status === "rejected" ? "rejected" : "unresolved",
			operation: suggestion.operation,
		};
	}

	private sameReviewerSignalRecord(
		left: ReviewerSignalRecord | undefined,
		right: ReviewerSignalRecord | null,
	): boolean {
		if (!left && !right) {
			return true;
		}

		if (!left || !right) {
			return false;
		}

		return (
			left.key === right.key &&
			left.reviewerId === right.reviewerId &&
			left.status === right.status &&
			left.operation === right.operation
		);
	}

	private applyReviewerSignalDelta(record: ReviewerSignalRecord, direction: 1 | -1): void {
		const profile = this.reviewerDirectory.getProfileById(record.reviewerId);
		if (!profile) {
			return;
		}

		const stats = {
			totalSuggestions: profile.stats?.totalSuggestions ?? 0,
			accepted: profile.stats?.accepted ?? 0,
			rejected: profile.stats?.rejected ?? 0,
			unresolved: profile.stats?.unresolved ?? 0,
			acceptedEdits: profile.stats?.acceptedEdits ?? 0,
			acceptedMoves: profile.stats?.acceptedMoves ?? 0,
		};

		stats.totalSuggestions = Math.max(0, stats.totalSuggestions + direction);
		if (record.status === "accepted") {
			stats.accepted = Math.max(0, stats.accepted + direction);
			if (record.operation === "move") {
				stats.acceptedMoves = Math.max(0, (stats.acceptedMoves ?? 0) + direction);
			} else if (record.operation === "replace") {
				stats.acceptedEdits = Math.max(0, (stats.acceptedEdits ?? 0) + direction);
			}
		} else if (record.status === "rejected") {
			stats.rejected = Math.max(0, stats.rejected + direction);
		} else {
			stats.unresolved = Math.max(0, stats.unresolved + direction);
		}

		this.reviewerDirectory.setStats(record.reviewerId, stats);
	}

	private sameRawReviewer(left: ParsedReviewerReference, right: ParsedReviewerReference): boolean {
		return (
			(left.rawName ?? "").trim() === (right.rawName ?? "").trim() &&
			(left.rawType ?? "").trim() === (right.rawType ?? "").trim() &&
			(left.rawProvider ?? "").trim() === (right.rawProvider ?? "").trim() &&
			(left.rawModel ?? "").trim() === (right.rawModel ?? "").trim()
		);
	}

	private parseReviewerKind(value?: string): ReviewSuggestion["contributor"]["kind"] {
		const normalized = value?.trim().toLowerCase();
		if (normalized === "editor" || normalized === "ai" || normalized === "author") {
			return normalized;
		}

		if (normalized === "betareader" || normalized === "beta-reader" || normalized === "beta reader") {
			return "beta-reader";
		}

		return "author";
	}

	private getActiveSessionForCurrentNote(): ReviewSession | null {
		const context = this.getActiveNoteContext();
		const session = this.store.getSession();
		if (!context || !session || session.notePath !== context.filePath) {
			return null;
		}

		return session;
	}

	private isActiveSessionForCurrentNote(): boolean {
		return Boolean(this.getActiveSessionForCurrentNote());
	}

	private hasActiveReviewSession(): boolean {
		return Boolean(this.getActiveSessionForCurrentNote()?.suggestions.length);
	}

	private revealSelectedSuggestion(): void {
		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			this.activeHighlightRange = null;
			return;
		}

		this.revealSuggestionContext(selectedSuggestion.id);
	}

	private revealSuggestionContext(id: string): void {
		const suggestion = this.getSuggestionById(id);
		if (!suggestion) {
			this.activeHighlightRange = null;
			return;
		}

		if (suggestion.operation === "move") {
			if (this.focusResolvedTarget(suggestion.target)) {
				return;
			}

			if (this.focusResolvedTarget(suggestion.anchor)) {
				return;
			}
		} else if (this.focusResolvedTarget(suggestion.manuscriptMatch)) {
			return;
		}

		const start = suggestion.source.startOffset;
		const end = suggestion.source.endOffset;
		if (start !== undefined && end !== undefined) {
			this.focusEditorRange(start, end);
			return;
		}

		this.activeHighlightRange = null;
	}

	private focusResolvedTarget(target?: ReviewTargetRef): boolean {
		if (!target || !this.hasResolvedRange(target)) {
			return false;
		}

		const start = target.startOffset;
		const end = target.endOffset;
		if (start === undefined || end === undefined) {
			return false;
		}

		this.focusEditorRange(start, end);
		return true;
	}

	private hasResolvedRange(target?: ReviewTargetRef): boolean {
		return Boolean(target && target.startOffset !== undefined && target.endOffset !== undefined);
	}

	private setDefaultHighlightForSelection(): void {
		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			this.activeHighlightRange = null;
			return;
		}

		const target =
			selectedSuggestion.operation === "move"
				? selectedSuggestion.target ?? selectedSuggestion.anchor
				: selectedSuggestion.manuscriptMatch;

		this.activeHighlightRange = this.hasResolvedRange(target)
			? {
					start: target?.startOffset as number,
					end: target?.endOffset as number,
				}
			: null;
	}

	private focusEditorRange(start: number, end: number): void {
		const context = this.getActiveNoteContext();
		if (!context) {
			return;
		}

		this.activeHighlightRange = { start, end };
		const from = context.view.editor.offsetToPos(start);
		const to = context.view.editor.offsetToPos(end);
		context.view.editor.setSelection(from, to);
		context.view.editor.scrollIntoView({ from, to }, true);
		this.syncActiveEditorDecorations();
	}

	private async loadPluginData(): Promise<void> {
		const savedData = (await this.loadData()) as Partial<EditorialistPluginData> | null;
		this.pluginData = {
			reviewerProfiles: Array.isArray(savedData?.reviewerProfiles) ? savedData?.reviewerProfiles : [],
			reviewerSignalIndex:
				savedData?.reviewerSignalIndex && typeof savedData.reviewerSignalIndex === "object"
					? savedData.reviewerSignalIndex
					: {},
		};
		this.reviewerDirectory.setProfiles(this.pluginData.reviewerProfiles);
	}

	private async savePluginData(): Promise<void> {
		this.pluginData = {
			reviewerProfiles: this.reviewerDirectory.getProfiles(),
			reviewerSignalIndex: this.pluginData.reviewerSignalIndex,
		};
		await this.saveData(this.pluginData);
	}
}
