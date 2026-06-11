import { ButtonComponent, DropdownComponent, ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { formatContributorIdentityLabel } from "../core/ContributorIdentity";
import { getEffectiveSuggestionStatus, getSuggestionCopyBlocks, getSuggestionReason as getOperationSuggestionReason, isImplicitlyAcceptedSuggestion, isMoveSuggestion } from "../core/OperationSupport";
import type { ReviewSuggestion, SceneMemo } from "../models/ReviewSuggestion";
import type { default as EditorialistPlugin, ReviewStateIndexEntry } from "../main";
import { bindImmediateAction } from "./util/bindImmediateAction";
// Pure projection helpers extracted to characterize ReviewPanel before the
// eventual file split. See src/ui/viewmodels/ReviewPanelViewModel.ts for the
// branch-decision contract (REVIEW_PANEL_BRANCH_ORDER + selectReviewPanelBranch)
// and the fixture-gated test suite.
import {
	selectPanelPrimarySuggestionId,
	shouldShowReviewerFilters,
} from "./viewmodels/ReviewPanelViewModel";
// Idle / completion / workspace section renderers extracted from the
// !session branch of render(). DOM/classes/callbacks are preserved exactly;
// see src/ui/panels/ReviewPanelIdleSections.ts.
import {
	renderCompletedSweepCard,
	renderContinueReviewCard,
	renderContributorsBlock,
	renderIdleStateCard,
	renderPendingEditsWorkspaceBlock,
	renderRecentActivityBlock,
	renderWorkflowsDisclosure,
	type IdleSectionsHost,
} from "./panels/ReviewPanelIdleSections";

export const REVIEW_PANEL_VIEW_TYPE = "editorialist-review-panel";

// Pulls the leading integer out of a scene/note title like "36 Stage 2 Part 2".
// Returns null when the title doesn't start with a number, so the comparator
// can sort numbered scenes (in story order) ahead of unnumbered ones.
function leadingSceneNumber(title: string): number | null {
	const match = title.match(/^\s*(\d+)\b/);
	if (!match) {
		return null;
	}
	const value = Number.parseInt(match[1]!, 10);
	return Number.isFinite(value) ? value : null;
}

function compareReviewStateEntriesByNarrativeOrder(
	a: ReviewStateIndexEntry,
	b: ReviewStateIndexEntry,
): number {
	const aNum = leadingSceneNumber(a.noteTitle);
	const bNum = leadingSceneNumber(b.noteTitle);
	if (aNum !== null && bNum !== null) {
		if (aNum !== bNum) {
			return aNum - bNum;
		}
		return a.noteTitle.localeCompare(b.noteTitle);
	}
	if (aNum !== null) return -1;
	if (bNum !== null) return 1;
	return a.noteTitle.localeCompare(b.noteTitle);
}

type ReviewerMenuAction = "assign" | "create" | "unresolved" | "save_alias";

export class ReviewPanel extends ItemView implements IdleSectionsHost {
	private jumpMenuSuggestionId: string | null = null;
	private reviewerFilterId: string | null = null;
	private reviewerMenuSuggestionId: string | null = null;
	private reviewerMenuAction: ReviewerMenuAction | null = null;
	private reviewerPickerValue: string | null = null;
	private starredOnly = false;
	private reviewStateProcessedExpanded = false;
	private pendingEditsExpanded = false;
	private commentsCollapsed = false;
	// null = follow the cold-start default; an explicit boolean once the user
	// toggles the onboarding disclosure within this view session.
	private onboardingExpanded: boolean | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: EditorialistPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return REVIEW_PANEL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Editorialist review";
	}

	getIcon(): string {
		return "pen-tool";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
		void this.plugin.closeActiveReviewContext();
	}

	render(): void {
		const session = this.plugin.getCurrentReviewSession();
		const selectedSuggestionId = this.plugin.getSelectedSuggestionId();
		this.contentEl.empty();
		this.contentEl.addClass("editorialist-panel");

		const completedSweep = this.plugin.getCompletedSweepPanelState();
		const postCompletionIdle = !session && !completedSweep ? this.plugin.getPostCompletionIdleState() : null;
		// The plugin's getPostCompletionIdleState() fires for BOTH a brand-new
		// vault (zero scene records) and a vault where every imported sweep
		// has been resolved. Only the first case is a true "empty workspace"
		// — the second has prior activity to surface. hasReviewActivityHistory
		// captures every signal that distinguishes them so the compact
		// onboarding card stays reserved for genuinely new users.
		const hasReviewActivityHistory =
			this.plugin.getSweepRegistryEntries().length > 0
			|| (this.plugin.getPendingEditsSummary()?.segmentCount ?? 0) > 0
			|| this.plugin.getSortedReviewerProfiles().length > 0
			|| this.plugin.getReviewStateOverview() !== null;
		const showCompactOnboardingCard = !session && !completedSweep
			&& Boolean(postCompletionIdle)
			&& !hasReviewActivityHistory;
		const launchTarget = !session && !completedSweep && !postCompletionIdle
			? this.plugin.getNextLogicalReviewLaunchTarget()
			: null;

		const header = this.contentEl.createDiv({ cls: "editorialist-panel__header" });
		const titleRow = header.createDiv({ cls: "editorialist-panel__title-row" });
		const titleIcon = titleRow.createSpan({ cls: "editorialist-panel__title-icon" });
		setIcon(titleIcon, "pen-tool");
		titleRow.createEl("h2", { text: "Editorialist review" });

		const settingsButton = titleRow.createEl("button", {
			cls: "editorialist-panel__settings-button",
			attr: {
				"aria-label": "Open Editorialist settings",
				title: "Open Editorialist settings",
				type: "button",
			},
		});
		const settingsIcon = settingsButton.createSpan({ cls: "editorialist-panel__settings-icon" });
		setIcon(settingsIcon, "settings");
		this.bindImmediateAction(settingsButton, () => {
			this.plugin.openSettings();
		});

		if (completedSweep) {
			renderCompletedSweepCard(this, this.plugin, this.contentEl, completedSweep);
			return;
		}

		if (!session) {
			// Compact "No active review" onboarding card fires only for a
			// genuinely empty workspace. Any prior activity (sweep history,
			// pending edits, contributors, review-state overview) preempts
			// it and falls through to the richer workspace composition.
			if (showCompactOnboardingCard && postCompletionIdle) {
				renderIdleStateCard(this, this.plugin, this.contentEl, postCompletionIdle);
				return;
			}

			const overview = this.plugin.getReviewStateOverview();
			const hasHistory =
				this.plugin.getSweepRegistryEntries().length > 0 ||
				this.plugin.getSortedReviewerProfiles().length > 0;

			// 1. Up next — the resumable work, grouped at the top. The Continue
			// Review hero anchors the cluster; the remaining pending sweeps
			// (every pending scene except the hero) follow directly beneath as a
			// scene list, so the two are read as one "what's waiting on me" unit
			// instead of competing cards. The processed "Ready to clean" group is
			// a separate cleanup chore and is rendered lower down, not here.
			if (launchTarget) {
				renderContinueReviewCard(this, this.plugin, this.contentEl, launchTarget, overview);
			}
			if (overview) {
				this.renderUpNextPendingScenes(overview.pending, launchTarget?.notePath ?? null, Boolean(launchTarget));
			}

			// 2. Pending edits — a formal, expandable block (header + per-scene
			// rows with an excerpt of the first item). Still surfaces the
			// "Review N pending edit items…" action; only appears when there are
			// actual pending edit segments.
			const pendingSummary = this.plugin.getPendingEditsSummary();
			if (pendingSummary && pendingSummary.segmentCount > 0) {
				renderPendingEditsWorkspaceBlock(this, this.plugin, this.contentEl, pendingSummary);
			}

			// 3. Recent review sessions.
			renderRecentActivityBlock(this.plugin, this.contentEl);

			// 4. Ready to clean — processed sweeps awaiting cleanup. Distinct from
			// the pending work above: it's post-resolution housekeeping, so it sits
			// after recent reviews rather than in the Up next cluster.
			if (overview && overview.processed.length > 0) {
				this.renderReadyToCleanCard(overview.processed);
			}

			// 5. Contributors.
			renderContributorsBlock(this.plugin, this.contentEl);

			// 6. Onboarding — demoted to a disclosure. Auto-expanded only on a
			// cold-start vault where there is nothing else to anchor on.
			renderWorkflowsDisclosure(this, this.plugin, this.contentEl, !hasHistory && !launchTarget);
			return;
		}

		const headerDetails = this.plugin.getReviewPanelHeaderDetails();
		header.createDiv({
			cls: "editorialist-panel__summary",
			text: headerDetails.summary,
		});

		const memos = session.memos ?? [];
		this.renderCommentsCard(memos);
		// Pending edits get their own always-present row during a batch (not
		// folded into the memo card), so the workflow stays reachable even on a
		// scene that has no pending items of its own.
		this.renderPendingEditsBatchRow(session.notePath);

		if (session.suggestions.length === 0) {
			if (memos.length === 0) {
				this.contentEl.createDiv({
					cls: "editorialist-panel__empty",
					text: "Formatted revision notes found, but no valid entries were parsed.",
				});
			}
			return;
		}

		const handoff = this.plugin.getGuidedSweepHandoffState();
		if (handoff) {
			this.renderSweepHandoffCard(handoff);
			return;
		}

		const panelOnlyState = this.plugin.getPanelOnlyReviewState();
		if (panelOnlyState) {
			this.renderPanelOnlyState(panelOnlyState);
		}

		if (shouldShowReviewerFilters(session.suggestions)) {
			this.renderFilters();
		} else {
			this.reviewerFilterId = null;
			this.starredOnly = false;
		}

		const list = this.contentEl.createDiv({ cls: "editorialist-suggestion-list" });
		const filteredSuggestions = this.getFilteredSuggestions(session.suggestions);
		if (filteredSuggestions.length === 0) {
			list.createDiv({
				cls: "editorialist-panel__empty",
				text: "No suggestions match the current reviewer filter.",
			});
			return;
		}

		let selectedCard: HTMLElement | null = null;
		let panelPrimaryCard: HTMLElement | null = null;
		const panelPrimarySuggestionId = panelOnlyState
			? selectPanelPrimarySuggestionId(filteredSuggestions, selectedSuggestionId)
			: null;
		filteredSuggestions.forEach((suggestion, index) => {
			const card = this.renderSuggestionCard(
				list,
				suggestion,
				selectedSuggestionId === suggestion.id,
				panelPrimarySuggestionId === suggestion.id,
				index,
				filteredSuggestions.length,
			);
			if (selectedSuggestionId === suggestion.id) {
				selectedCard = card;
			}
			if (panelPrimarySuggestionId === suggestion.id) {
				panelPrimaryCard = card;
			}
		});

		const cardToCenter = (selectedCard ?? panelPrimaryCard) as HTMLElement | null;
		if (cardToCenter) {
			const targetCard = cardToCenter;
			window.requestAnimationFrame(() => {
				if (targetCard.isConnected) {
					this.centerCardInScrollView(targetCard);
				}
			});
		}
	}


	// Pending scenes that belong to the "Up next" cluster beneath the Continue
	// Review hero. When the hero is shown, its scene is filtered out (by path,
	// so duplicate-title scenes don't collapse together) and a quiet subhead
	// introduces the remainder. With no hero, this stands alone under an
	// "Up next" header.
	private renderUpNextPendingScenes(
		pending: ReviewStateIndexEntry[],
		excludeNotePath: string | null,
		heroShown: boolean,
	): void {
		const remaining = pending.filter((entry) => entry.notePath !== excludeNotePath);
		if (remaining.length === 0) {
			return;
		}

		const card = this.contentEl.createDiv({
			cls: "editorialist-panel__review-state editorialist-panel__review-state--upnext",
		});

		if (heroShown) {
			card.createDiv({
				cls: "editorialist-panel__review-state-subhead",
				text: remaining.length === 1 ? "1 more pending scene" : `${remaining.length} more pending scenes`,
			});
		} else {
			const header = card.createDiv({ cls: "editorialist-panel__review-state-header" });
			const titleIcon = header.createSpan({ cls: "editorialist-panel__review-state-title-icon" });
			setIcon(titleIcon, "list-checks");
			header.createSpan({ cls: "editorialist-panel__review-state-title", text: "Up next" });
			header.createSpan({
				cls: "editorialist-panel__review-state-summary",
				text: `${remaining.length} pending`,
			});
		}

		const list = card.createDiv({ cls: "editorialist-panel__review-state-list" });
		const sorted = [...remaining].sort(compareReviewStateEntriesByNarrativeOrder);
		for (const entry of sorted) {
			this.renderReviewStateRow(list, entry, false);
		}
	}

	// Processed sweeps awaiting review-block cleanup. Its own collapsible group
	// (the group header carries the caret + count + Clean actions), rendered as
	// a standalone secondary card below recent reviews.
	private renderReadyToCleanCard(processed: ReviewStateIndexEntry[]): void {
		const card = this.contentEl.createDiv({ cls: "editorialist-panel__review-state" });
		this.renderReviewStateGroup(card, "Ready to clean", processed, true, this.reviewStateProcessedExpanded, true);
	}

	private renderReviewStateGroup(
		parent: HTMLElement,
		label: string,
		entries: ReviewStateIndexEntry[],
		showCleanAction: boolean,
		expanded: boolean = true,
		renderGroupHeader: boolean = true,
	): void {
		const group = parent.createDiv({ cls: "editorialist-panel__review-state-group" });
		const isCollapsible = showCleanAction;
		// Force the group open when its header isn't drawn — there'd be no way
		// to expand it back.
		const isOpen = !isCollapsible || expanded || !renderGroupHeader;

		if (renderGroupHeader) {
			const groupHeader = group.createDiv({
				cls: `editorialist-panel__review-state-group-header${isCollapsible ? " editorialist-panel__review-state-group-header--collapsible" : ""}`,
			});

			if (isCollapsible) {
				const caret = groupHeader.createSpan({ cls: "editorialist-panel__review-state-group-caret" });
				setIcon(caret, isOpen ? "chevron-down" : "chevron-right");
				this.bindImmediateAction(groupHeader, () => {
					this.reviewStateProcessedExpanded = !this.reviewStateProcessedExpanded;
					this.render();
				});
			}

			groupHeader.createSpan({
				cls: "editorialist-panel__review-state-group-label",
				text: label,
			});
			groupHeader.createSpan({
				cls: "editorialist-panel__review-state-group-count",
				text: `${entries.length}`,
			});
		}

		if (!isOpen) {
			return;
		}

		const list = group.createDiv({ cls: "editorialist-panel__review-state-list" });

		// Narrative order: ascending scene number so the author works the
		// batches in story order. Notes without a leading number sort after
		// numbered ones, alphabetically by title.
		const sorted = [...entries].sort(compareReviewStateEntriesByNarrativeOrder);
		for (const entry of sorted) {
			this.renderReviewStateRow(list, entry, showCleanAction);
		}
	}

	private renderReviewStateRow(
		parent: HTMLElement,
		entry: ReviewStateIndexEntry,
		showCleanAction: boolean,
	): void {
		const row = parent.createDiv({ cls: "editorialist-panel__review-state-row" });

		const link = row.createEl("a", {
			cls: "editorialist-panel__review-state-row-link",
			attr: {
				href: "#",
				title: `Open ${entry.noteTitle}`,
			},
		});
		link.createSpan({
			cls: "editorialist-panel__review-state-row-title",
			text: entry.noteTitle,
		});
		this.bindImmediateAction(link, () => {
			void this.plugin.startOrResumeReviewForNote(entry.notePath);
		});

		const metaParts: string[] = [];
		if (entry.pendingCount > 0) {
			metaParts.push(`${entry.pendingCount} pending`);
		}
		if (entry.deferredCount > 0) {
			metaParts.push(`${entry.deferredCount} deferred`);
		}
		if (entry.processedCount > 0) {
			metaParts.push(`${entry.processedCount} processed`);
		}
		if (metaParts.length > 0) {
			row.createSpan({
				cls: "editorialist-panel__review-state-row-meta",
				text: metaParts.join(" · "),
			});
		}

		if (showCleanAction) {
			const cleanButton = row.createEl("button", {
				cls: "editorialist-panel__review-state-row-clean",
				attr: { type: "button", title: "Clean review block from this scene" },
			});
			const cleanIcon = cleanButton.createSpan({ cls: "editorialist-panel__review-state-row-clean-icon" });
			setIcon(cleanIcon, "eraser");
			cleanButton.createSpan({
				cls: "editorialist-panel__review-state-row-clean-text",
				text: "Clean",
			});
			this.bindImmediateAction(cleanButton, () => {
				void this.plugin.cleanSceneReviewNote(entry.notePath).then(() => {
					this.render();
				});
			});
		}
	}

	private renderCommentsCard(memos: SceneMemo[]): void {
		const hasMemos = memos.length > 0;
		if (!hasMemos) {
			return;
		}

		const card = this.contentEl.createDiv({
			cls: `editorialist-panel__comments${this.commentsCollapsed ? " is-collapsed" : ""}`,
		});

		const header = card.createDiv({ cls: "editorialist-panel__comments-header" });
		const titleIcon = header.createSpan({ cls: "editorialist-panel__comments-title-icon" });
		setIcon(titleIcon, "message-square-text");
		header.createSpan({
			cls: "editorialist-panel__comments-title",
			text: "Comments",
		});
		header.createSpan({
			cls: "editorialist-panel__comments-summary",
			text: `${memos.length} memo${memos.length === 1 ? "" : "s"}`,
		});

		const toggle = header.createEl("button", {
			cls: "editorialist-panel__comments-toggle",
			attr: {
				type: "button",
				"aria-label": this.commentsCollapsed ? "Show comments" : "Hide comments",
				"aria-expanded": this.commentsCollapsed ? "false" : "true",
				title: this.commentsCollapsed ? "Show comments" : "Hide comments",
			},
		});
		const toggleIcon = toggle.createSpan({ cls: "editorialist-panel__comments-toggle-icon" });
		setIcon(toggleIcon, this.commentsCollapsed ? "chevron-down" : "chevron-up");
		this.bindImmediateAction(toggle, () => {
			this.commentsCollapsed = !this.commentsCollapsed;
			this.render();
		});

		if (this.commentsCollapsed) {
			return;
		}

		const body = card.createDiv({ cls: "editorialist-panel__comments-body" });

		memos.forEach((memo) => {
			this.renderMemoEntry(body, memo);
		});
	}

	// Always-present pending-edits affordance during a batch. Scene-scoped when
	// the active scene has its own items; otherwise falls back to a book-wide
	// entry so pending work elsewhere in the book stays reachable mid-batch.
	// Renders nothing only when the entire book has zero pending edits.
	private renderPendingEditsBatchRow(notePath: string): void {
		const sceneCount = this.plugin.getPendingEditsCountForScene(notePath);
		const bookCount = this.plugin.getPendingEditsSummary()?.segmentCount ?? 0;
		if (sceneCount === 0 && bookCount === 0) {
			return;
		}

		const card = this.contentEl.createDiv({ cls: "editorialist-panel__comments" });
		const header = card.createDiv({ cls: "editorialist-panel__comments-header" });
		const titleIcon = header.createSpan({ cls: "editorialist-panel__comments-title-icon" });
		setIcon(titleIcon, "clipboard-list");
		header.createSpan({ cls: "editorialist-panel__comments-title", text: "Pending edits" });
		header.createSpan({
			cls: "editorialist-panel__comments-summary",
			text: sceneCount > 0 ? `${sceneCount} on this scene` : `${bookCount} in this book`,
		});

		const body = card.createDiv({ cls: "editorialist-panel__comments-body" });
		if (sceneCount > 0) {
			this.renderPendingEditsEntry(body, {
				countLabel: `${sceneCount} item${sceneCount === 1 ? "" : "s"} on this scene`,
				linkText: "→ Review pending edits in this scene",
				tooltip: "Review the pending edits on this scene",
				onClick: () => this.plugin.startPendingEditsReviewForScene(notePath),
			});
		} else {
			this.renderPendingEditsEntry(body, {
				countLabel: `${bookCount} item${bookCount === 1 ? "" : "s"} elsewhere in this book`,
				linkText: "→ Review all pending edits",
				tooltip: "Start a pending-edits review across the active book",
				onClick: () => this.plugin.startPendingEditsReview(),
			});
		}
	}

	private renderMemoEntry(parent: HTMLElement, memo: SceneMemo): void {
		const entry = parent.createDiv({ cls: "editorialist-panel__comment-entry editorialist-panel__comment-entry--memo" });

		const header = entry.createDiv({ cls: "editorialist-panel__comment-entry-header" });
		const kindBadge = header.createSpan({ cls: "editorialist-panel__comment-entry-kind" });
		kindBadge.setText("Memo");
		header.createSpan({
			cls: "editorialist-panel__comment-entry-contributor",
			text: formatContributorIdentityLabel(memo.contributor),
		});

		if (memo.strengths) {
			const block = entry.createDiv({ cls: "editorialist-panel__comment-entry-block" });
			block.createDiv({
				cls: "editorialist-panel__comment-entry-block-label editorialist-panel__comment-entry-block-label--strengths",
				text: "Strengths",
			});
			block.createDiv({ cls: "editorialist-panel__comment-entry-block-text", text: memo.strengths });
		}

		if (memo.issues) {
			const block = entry.createDiv({ cls: "editorialist-panel__comment-entry-block" });
			block.createDiv({
				cls: "editorialist-panel__comment-entry-block-label editorialist-panel__comment-entry-block-label--issues",
				text: "Issues",
			});
			block.createDiv({ cls: "editorialist-panel__comment-entry-block-text", text: memo.issues });
		}

		if (memo.body && !memo.strengths && !memo.issues) {
			entry.createDiv({ cls: "editorialist-panel__comment-entry-block-text", text: memo.body });
		} else if (memo.body) {
			const block = entry.createDiv({ cls: "editorialist-panel__comment-entry-block" });
			block.createDiv({
				cls: "editorialist-panel__comment-entry-block-label",
				text: "Notes",
			});
			block.createDiv({ cls: "editorialist-panel__comment-entry-block-text", text: memo.body });
		}
	}

	private renderPendingEditsEntry(
		parent: HTMLElement,
		options: { countLabel: string; linkText: string; tooltip: string; onClick: () => void | Promise<void> },
	): void {
		const entry = parent.createDiv({ cls: "editorialist-panel__comment-entry editorialist-panel__comment-entry--pending" });

		const header = entry.createDiv({ cls: "editorialist-panel__comment-entry-header" });
		const kindBadge = header.createSpan({ cls: "editorialist-panel__comment-entry-kind" });
		kindBadge.setText("Pending edits");
		header.createSpan({
			cls: "editorialist-panel__comment-entry-contributor",
			text: options.countLabel,
		});

		const actionRow = entry.createDiv({ cls: "editorialist-panel__comment-entry-action" });
		const link = actionRow.createEl("a", {
			cls: "editorialist-panel__comment-entry-action-link",
			attr: { href: "#", title: options.tooltip },
		});
		link.createSpan({ text: options.linkText });
		this.bindImmediateAction(link, () => {
			void options.onClick();
		});
	}

	private renderFilters(): void {
		const controls = this.contentEl.createDiv({ cls: "editorialist-panel__filters" });
		const filterLabel = controls.createDiv({ cls: "editorialist-panel__filter-label" });
		filterLabel.setText("Contributor filter");

		const filterControls = controls.createDiv({ cls: "editorialist-panel__filter-controls" });
		const inlineGroup = filterControls.createDiv({ cls: "editorialist-panel__filter-inline-group" });
		const dropdownContainer = inlineGroup.createDiv({ cls: "editorialist-panel__filter-control" });
		const dropdown = new DropdownComponent(dropdownContainer);
		dropdown.addOption("", "All contributors");
		this.plugin.getSortedReviewerProfiles().forEach((profile) => {
			dropdown.addOption(profile.id, formatContributorIdentityLabel(profile));
		});
		dropdown.setValue(this.reviewerFilterId ?? "");
		dropdown.onChange((value) => {
			this.reviewerFilterId = value || null;
			this.render();
		});

		const starredButton = new ButtonComponent(inlineGroup).onClick(() => {
			this.starredOnly = !this.starredOnly;
			this.render();
		});
		starredButton.buttonEl.addClass("editorialist-panel__filter-icon-button");
		if (this.starredOnly) {
			starredButton.buttonEl.addClass("is-active");
		}
		starredButton.buttonEl.setAttribute("aria-label", this.starredOnly ? "Show all reviewers" : "Show starred reviewers");
		starredButton.buttonEl.setAttribute("title", this.starredOnly ? "Show all reviewers" : "Show starred reviewers");
		setIcon(starredButton.buttonEl, "star");
	}

	private renderSweepHandoffCard(handoff: ReturnType<EditorialistPlugin["getGuidedSweepHandoffState"]>): void {
		if (!handoff) {
			return;
		}

		const card = this.contentEl.createDiv({ cls: "editorialist-panel__handoff" });
		const header = card.createDiv({ cls: "editorialist-panel__handoff-header" });
		header.createDiv({
			cls: "editorialist-panel__handoff-title",
			text: handoff.title,
		});
		header.createDiv({
			cls: "editorialist-panel__handoff-progress",
			text: handoff.panelProgressLabel,
		});

		card.createDiv({
			cls: "editorialist-panel__handoff-summary",
			text: handoff.summary,
		});

		if (handoff.nextLabel && !handoff.isFinal) {
			const next = card.createDiv({ cls: "editorialist-panel__handoff-next" });
			next.createSpan({
				cls: "editorialist-panel__handoff-next-label",
				text: `Next ${handoff.unitLabel} → ${handoff.nextLabel}`,
			});
		}

		const actions = card.createDiv({ cls: "editorialist-panel__handoff-actions" });
		const primaryAction = new ButtonComponent(actions)
			.setButtonText(handoff.primaryActionLabel)
			.setCta();
		this.bindImmediateAction(primaryAction.buttonEl, () => {
			if (handoff.isFinal) {
				void this.plugin.finishGuidedSweep();
				return;
			}

			void this.plugin.continueGuidedSweep();
		});

		if (handoff.secondaryActionLabel) {
			const secondaryAction = new ButtonComponent(actions).setButtonText(handoff.secondaryActionLabel);
			this.bindImmediateAction(secondaryAction.buttonEl, () => {
				void this.plugin.finishGuidedSweep();
			});
		}
	}

	private renderPanelOnlyState(panelOnlyState: ReturnType<EditorialistPlugin["getPanelOnlyReviewState"]>): void {
		if (!panelOnlyState) {
			return;
		}

		const card = this.contentEl.createDiv({ cls: "editorialist-panel__panel-only" });
		const header = card.createDiv({ cls: "editorialist-panel__panel-only-header" });
		const title = header.createDiv({ cls: "editorialist-panel__panel-only-title" });
		const titleIcon = title.createSpan({ cls: "editorialist-panel__panel-only-title-icon" });
		setIcon(titleIcon, "pen-tool");
		title.createSpan({ text: panelOnlyState.title });
		if (panelOnlyState.progressLabel) {
			header.createDiv({
				cls: "editorialist-panel__panel-only-progress",
				text: panelOnlyState.progressLabel,
			});
		}

		card.createDiv({
			cls: "editorialist-panel__panel-only-copy",
			text: panelOnlyState.description,
		});
	}

	private renderSuggestionCard(
		parent: HTMLElement,
		suggestion: ReviewSuggestion,
		selected: boolean,
		panelPrimary: boolean,
		index: number,
		total: number,
	): HTMLElement {
		const statusName = this.getVisualStatusName(suggestion);
		const tone = this.getVisualTone(suggestion);
		const isCollapsed = !selected && this.reviewerMenuSuggestionId !== suggestion.id && this.jumpMenuSuggestionId !== suggestion.id;

		const card = parent.createDiv({
			cls: `editorialist-suggestion editorialist-suggestion--${statusName} editorialist-suggestion--tone-${tone}${selected ? " is-selected" : ""}${panelPrimary ? " is-panel-primary" : ""}${isCollapsed ? " is-collapsed" : ""}`,
		});
		this.bindImmediateAction(card, () => {
			void this.plugin.selectSuggestion(suggestion.id);
		});

		const summary = card.createDiv({ cls: "editorialist-suggestion__summary" });
		const summaryStatus = summary.createDiv({
			cls: `editorialist-suggestion__label editorialist-suggestion__label--${statusName}`,
			attr: {
				title: `${this.toSentenceCase(suggestion.operation)} suggestion`,
			},
		});
		const summaryStatusIcon = summaryStatus.createSpan({ cls: "editorialist-suggestion__label-icon" });
		setIcon(summaryStatusIcon, this.getOperationIcon(suggestion));
		summaryStatus.createSpan({
			cls: "editorialist-suggestion__label-separator",
			text: "•",
		});
		summaryStatus.createSpan({
			cls: "editorialist-suggestion__label-text",
			text: this.getStatusLabel(suggestion),
		});
		summary.createDiv({
			cls: "editorialist-suggestion__summary-preview",
			text: this.getCollapsedPreview(suggestion),
		});

		const meta = card.createDiv({ cls: "editorialist-suggestion__meta" });
		const metaPrimary = meta.createDiv({ cls: "editorialist-suggestion__meta-primary" });
		const status = metaPrimary.createDiv({
			cls: `editorialist-suggestion__label editorialist-suggestion__label--${statusName}`,
			attr: {
				title: `${this.toSentenceCase(suggestion.operation)} suggestion`,
			},
		});
		const statusIcon = status.createSpan({ cls: "editorialist-suggestion__label-icon" });
		setIcon(statusIcon, this.getOperationIcon(suggestion));
		status.createSpan({
			cls: "editorialist-suggestion__label-separator",
			text: "•",
		});
		status.createSpan({
			cls: "editorialist-suggestion__label-text",
			text: this.getStatusLabel(suggestion),
		});
		metaPrimary.createDiv({
			cls: "editorialist-suggestion__position",
			text: `${index + 1} of ${total}`,
		});

		this.renderSuggestionCopy(card, suggestion, selected);

		const reason = card.createDiv({
			cls: `editorialist-suggestion__reason editorialist-suggestion__reason--${this.getSuggestionReasonTone(suggestion)}`,
		});
		const reasonIcon = reason.createSpan({ cls: "editorialist-suggestion__reason-icon" });
		setIcon(reasonIcon, this.getSuggestionReasonIcon(suggestion));
		reason.createSpan({
			cls: "editorialist-suggestion__reason-text",
			text: this.getSuggestionReason(suggestion),
		});

		this.renderSuggestionFooter(card, suggestion);

		if (this.reviewerMenuSuggestionId === suggestion.id) {
			this.renderReviewerMenu(card, suggestion);
		}

		if (this.jumpMenuSuggestionId === suggestion.id) {
			this.renderJumpMenu(card, suggestion);
		}

		return card;
	}

	// Renders the unified footer row: contributor (left), then jump-options
	// pointer and "Mark as rewritten" (right). Replaces the older header-cluster
	// of control pills; keeps the header purely informational (status + position).
	private renderSuggestionFooter(parent: HTMLElement, suggestion: ReviewSuggestion): void {
		const footer = parent.createDiv({ cls: "editorialist-suggestion__footer" });
		const hasReviewerMenu = this.needsReviewerMenu(suggestion);
		const sourceButton = this.renderControlButton(
			footer,
			this.getSourceLabel(suggestion),
			() => {
				this.toggleReviewerMenu(suggestion);
			},
			{
				disabled: !hasReviewerMenu,
				icon: "user",
				trailingIcon: hasReviewerMenu ? (this.reviewerMenuSuggestionId === suggestion.id ? "chevron-up" : "chevron-down") : undefined,
			},
		);
		sourceButton.addClass("editorialist-suggestion__control--source");

		const trailingActions = footer.createDiv({ cls: "editorialist-suggestion__footer-actions" });

		if (this.plugin.canMarkSuggestionRewritten(suggestion.id)) {
			this.renderControlButton(
				trailingActions,
				"Mark as rewritten",
				() => {
					void this.plugin.markSuggestionRewritten(suggestion.id);
				},
				{
					icon: "pen-line",
				},
			);
		}

		this.renderControlButton(
			trailingActions,
			"",
			() => {
				this.toggleJumpMenu(suggestion.id);
			},
			{
				disabled: !this.hasAnyJumpTarget(suggestion.id),
				icon: "navigation",
				iconOnly: true,
				active: this.jumpMenuSuggestionId === suggestion.id,
				tooltip: this.jumpMenuSuggestionId === suggestion.id ? "Hide jump options" : "Show jump options",
			},
		);
	}

	private renderSuggestionCopy(parent: HTMLElement, suggestion: ReviewSuggestion, active: boolean): void {
		const copy = parent.createDiv({ cls: "editorialist-suggestion__copy" });
		if (active && this.renderSuggestionStructure(copy, suggestion)) {
			if (suggestion.why) {
				this.renderCopyBlock(copy, "WHY", suggestion.why);
			}
			return;
		}

		getSuggestionCopyBlocks(suggestion).forEach((block) => {
			this.renderCopyBlock(copy, block.label, block.body);
		});
		if (suggestion.why) {
			this.renderCopyBlock(copy, "WHY", suggestion.why);
		}
	}

	private renderSuggestionStructure(parent: HTMLElement, suggestion: ReviewSuggestion): boolean {
		if (this.isOtherTextSuggestion(suggestion)) {
			return false;
		}

		switch (suggestion.operation) {
			case "edit":
				this.renderComparisonStructure(parent, "Original", suggestion.payload.original, "Revised", suggestion.payload.revised);
				return true;
			case "condense":
				this.renderComparisonStructure(
					parent,
					"Condense this",
					suggestion.payload.target,
					"Suggested version",
					suggestion.payload.suggestion ?? "Condense this paragraph.",
					"condense",
				);
				return true;
			case "expand":
				this.renderComparisonStructure(
					parent,
					"Expand this",
					suggestion.payload.target,
					"Suggested version",
					suggestion.payload.suggestion ?? "Develop this beat.",
					"expand",
				);
				return true;
			case "cut":
				this.renderDeleteStructure(parent, "Remove", suggestion.payload.target);
				return true;
			case "move":
				this.renderMoveStructure(parent, suggestion);
				return true;
		}
	}

	private renderComparisonStructure(
		parent: HTMLElement,
		beforeLabel: string,
		beforeText: string,
		afterLabel: string,
		afterText: string,
		variant: "edit" | "condense" | "expand" = "edit",
	): void {
		const isCondense = variant === "condense";
		const isExpand = variant === "expand";
		// Condense and expand share the "reshape a passage into a suggested
		// version" visual treatment; only the leading icon and copy text differ.
		const isReshape = isCondense || isExpand;
		const variantClass = isCondense
			? " editorialist-suggestion__structure--condense"
			: isExpand
				? " editorialist-suggestion__structure--expand"
				: "";
		const structure = parent.createDiv({
			cls: `editorialist-suggestion__structure editorialist-suggestion__structure--comparison${variantClass}`,
		});
		this.renderStructureBlock(structure, beforeLabel, beforeText, {
			icon: isCondense ? "minimize-2" : isExpand ? "maximize-2" : "align-left",
			tone: "ghost",
		});
		const bridge = structure.createDiv({ cls: "editorialist-suggestion__structure-bridge" });
		const bridgeIcon = bridge.createSpan({ cls: "editorialist-suggestion__structure-bridge-icon" });
		setIcon(bridgeIcon, isReshape ? "arrow-down" : "arrow-right");
		bridge.createSpan({
			cls: "editorialist-suggestion__structure-bridge-text",
			text: isCondense
				? "Condense to this version"
				: isExpand
					? "Expand to this version"
					: "Replace with this version",
		});
		this.renderStructureBlock(structure, afterLabel, afterText, {
			icon: isReshape ? "sparkles" : "check",
			copyHint: "Click to copy",
			copyNotice: isReshape ? "Suggestion copied" : "Revised text copied",
			tone: "active",
		});
	}

	private renderMoveStructure(parent: HTMLElement, suggestion: Extract<ReviewSuggestion, { operation: "move" }>): void {
		const structure = parent.createDiv({
			cls: "editorialist-suggestion__structure editorialist-suggestion__structure--move",
		});
		const split = structure.createDiv({
			cls: "editorialist-suggestion__structure-split editorialist-suggestion__structure-split--move",
		});
		const sourceColumn = split.createDiv({ cls: "editorialist-suggestion__structure-column" });
		const bridge = split.createDiv({
			cls: "editorialist-suggestion__structure-bridge editorialist-suggestion__structure-bridge--move",
		});
		const destinationColumn = split.createDiv({ cls: "editorialist-suggestion__structure-column" });
		const direction = this.getMoveDirection(suggestion);
		const destinationResolved = this.plugin.canJumpToSuggestionAnchor(suggestion.id);
		const placementLabel =
			suggestion.payload.placement === "after" ? "Place it after this" : "Place it before this";
		const placementIcon = suggestion.payload.placement === "after" ? "corner-up-left" : "corner-down-left";

		this.renderStructureMiniHeader(sourceColumn, "Move this text", {
			icon: "arrow-right-left",
			align: "start",
		});
		this.renderStructureBlock(sourceColumn, "", suggestion.payload.target, {
			accent: "source",
			tone: "ghost",
			hideHeader: true,
		});

		// The bridge arrow points the reviewer toward the destination: up if it
		// sits earlier in the manuscript, down if later. Falls back to a neutral
		// arrow when the destination couldn't be located (direction unknown).
		const bridgeIcon = bridge.createSpan({ cls: "editorialist-suggestion__structure-bridge-icon" });
		setIcon(bridgeIcon, direction === "up" ? "arrow-up" : direction === "down" ? "arrow-down" : "arrow-right");
		if (direction) {
			bridge.setAttribute("aria-label", `Destination is ${direction} in this scene`);
		}

		this.renderStructureMiniHeader(destinationColumn, placementLabel, {
			icon: direction === "up" ? "arrow-up" : direction === "down" ? "arrow-down" : placementIcon,
			align: "start",
		});
		this.renderStructureBlock(destinationColumn, "", suggestion.payload.anchor, {
			accent: "anchor",
			tone: "muted",
			hideHeader: true,
			// When the destination resolved, clicking jumps the editor to it so the
			// reviewer can see exactly where the text lands. When it didn't, flag
			// the block so the card itself shows which side failed.
			...(destinationResolved
				? {
						onActivate: () => void this.plugin.jumpToSuggestionAnchor(suggestion.id),
						activateHint: "Jump",
						activateLabel: "Jump to the destination",
					}
				: { unresolved: true }),
		});
	}

	private getMoveDirection(
		suggestion: Extract<ReviewSuggestion, { operation: "move" }>,
	): "up" | "down" | null {
		const relocation = suggestion.location.relocation;
		if (!relocation || relocation.targetStart === undefined || relocation.anchorStart === undefined) {
			return null;
		}
		return relocation.anchorStart < relocation.targetStart ? "up" : "down";
	}

	private renderDeleteStructure(parent: HTMLElement, label: string, text: string): void {
		const structure = parent.createDiv({
			cls: "editorialist-suggestion__structure editorialist-suggestion__structure--delete",
		});
		this.renderStructureBlock(structure, label, text, {
			icon: "scissors-line-dashed",
			tone: "ghost",
			state: "delete",
		});
	}

	private renderStructureBlock(
		parent: HTMLElement,
		label: string,
		text: string,
		options: {
			accent?: "anchor" | "source";
			activateHint?: string;
			activateLabel?: string;
			copyHint?: string;
			copyNotice?: string;
			hideHeader?: boolean;
			icon?: string;
			onActivate?: () => void;
			state?: "insert" | "delete";
			tone: "active" | "ghost" | "muted";
			unresolved?: boolean;
		},
	): void {
		const block = parent.createDiv({
			cls: `editorialist-suggestion__structure-block editorialist-suggestion__structure-block--${options.tone}${options.state ? ` editorialist-suggestion__structure-block--${options.state}` : ""}`,
		});
		if (options.accent) {
			block.addClass(`editorialist-suggestion__structure-block--${options.accent}`);
		}
		if (options.unresolved) {
			block.addClass("editorialist-suggestion__structure-block--unresolved");
		}
		if (options.onActivate) {
			block.addClass("is-actionable");
			block.setAttribute("role", "button");
			block.setAttribute("tabindex", "0");
			if (options.activateLabel) {
				block.setAttribute("aria-label", options.activateLabel);
			}
			this.bindImmediateAction(block, options.onActivate);
		} else if (options.copyHint) {
			block.addClass("is-copyable");
			block.setAttribute("role", "button");
			block.setAttribute("tabindex", "0");
			block.setAttribute("aria-label", `${options.copyHint}: ${label}`);
			this.bindImmediateAction(block, () => {
				void this.plugin.copyTextToClipboard(
					text,
					options.copyNotice ?? "Copied to clipboard",
					"Could not copy the text.",
				);
			});
		}
		if (!options.hideHeader) {
			const header = block.createDiv({ cls: "editorialist-suggestion__structure-block-header" });
			if (options.icon) {
				const icon = header.createSpan({ cls: "editorialist-suggestion__structure-block-icon" });
				setIcon(icon, options.icon);
			}
			header.createSpan({
				cls: "editorialist-suggestion__structure-block-label",
				text: label,
			});
			if (options.copyHint) {
				header.createSpan({
					cls: "editorialist-suggestion__structure-copy-hint",
					text: options.copyHint,
				});
			}
		}
		if (options.activateHint) {
			const hint = block.createSpan({
				cls: "editorialist-suggestion__structure-action-hint",
			});
			setIcon(hint.createSpan({ cls: "editorialist-suggestion__structure-action-hint-icon" }), "scan-search");
			hint.createSpan({ text: options.activateHint });
		}
		block.createDiv({
			cls: "editorialist-suggestion__structure-block-body",
			text,
		});
	}

	private renderStructureMiniHeader(
		parent: HTMLElement,
		label: string,
		options: { align?: "end" | "start"; icon: string },
	): void {
		const header = parent.createDiv({
			cls: `editorialist-suggestion__structure-mini-header${options.align === "end" ? " is-align-end" : ""}`,
		});
		if (options.align === "end") {
			header.addClass("is-icon-leading");
		}
		const icon = header.createSpan({ cls: "editorialist-suggestion__structure-mini-header-icon" });
		setIcon(icon, options.icon);
		header.createSpan({
			cls: "editorialist-suggestion__structure-mini-header-label",
			text: label,
		});
	}

	private getCollapsedPreview(suggestion: ReviewSuggestion): string {
		if (this.isOtherTextSuggestion(suggestion)) {
			if (suggestion.operation === "cut") {
				return "Already removed";
			}
			return "Passage not located";
		}

		switch (suggestion.operation) {
			case "edit":
				return suggestion.payload.revised;
			case "cut":
				return "Remove paragraph";
			case "condense":
				return suggestion.payload.suggestion ?? "Condense paragraph";
			case "expand":
				return suggestion.payload.suggestion ?? "Develop this beat";
			case "move":
				return suggestion.payload.placement === "after"
					? "Move text after another passage"
					: "Move text before another passage";
		}
	}

	private renderReviewerMenu(parent: HTMLElement, suggestion: ReviewSuggestion): void {
		const picker = parent.createDiv({ cls: "editorialist-reviewer-picker" });
		picker.createDiv({
			cls: "editorialist-reviewer-picker__label",
			text: this.getSourceLabel(suggestion),
		});

		const profiles = this.plugin.getSortedReviewerProfiles();
		const actionControl = picker.createDiv({ cls: "editorialist-reviewer-picker__control" });
		const actionDropdown = new DropdownComponent(actionControl);
		actionDropdown.addOption("", "Choose action");
		if (profiles.length > 0) {
			actionDropdown.addOption("assign", "Assign existing");
		}
		actionDropdown.addOption("create", "Create new");
		actionDropdown.addOption("unresolved", "Leave unresolved");
		if (this.plugin.canSaveReviewerAlias(suggestion.id)) {
			actionDropdown.addOption("save_alias", "Save raw name as alias");
		}
		actionDropdown.setValue(this.reviewerMenuAction ?? "");
		actionDropdown.onChange((value) => {
			void this.handleReviewerMenuAction(suggestion, value);
		});

		if (this.reviewerMenuAction === "assign" && profiles.length > 0) {
			const dropdownContainer = picker.createDiv({ cls: "editorialist-reviewer-picker__control" });
			const dropdown = new DropdownComponent(dropdownContainer);
			profiles.forEach((profile) => {
				dropdown.addOption(profile.id, formatContributorIdentityLabel(profile));
			});
			dropdown.setValue(this.reviewerPickerValue ?? profiles[0]?.id ?? "");
			dropdown.onChange((value) => {
				this.reviewerPickerValue = value || null;
				if (this.reviewerPickerValue) {
					void this.plugin.useSuggestedReviewer(suggestion.id, this.reviewerPickerValue);
				}
				this.closeReviewerMenu();
			});
		}
	}

	private renderJumpMenu(parent: HTMLElement, suggestion: ReviewSuggestion): void {
		const menu = parent.createDiv({ cls: "editorialist-reviewer-picker" });
		menu.createDiv({
			cls: "editorialist-reviewer-picker__label",
			text: "Jump to",
		});

		const actions = menu.createDiv({ cls: "editorialist-reviewer-picker__actions" });
		this.renderControlButton(
			actions,
			"",
			() => {
				void this.plugin.jumpToSuggestionTarget(suggestion.id);
				this.closeJumpMenu();
			},
			{
				disabled: !this.plugin.canJumpToSuggestionTarget(suggestion.id),
				icon: "crosshair",
				iconOnly: true,
				tooltip: "Jump to this text",
			},
		);
		this.renderControlButton(
			actions,
			"",
			() => {
				void this.plugin.jumpToSuggestionSource(suggestion.id);
				this.closeJumpMenu();
			},
			{
				disabled: !this.plugin.canJumpToSuggestionSource(suggestion.id),
				icon: "file-text",
				iconOnly: true,
				tooltip: "Jump to the note",
			},
		);
		if (isMoveSuggestion(suggestion)) {
			this.renderControlButton(
				actions,
				"",
				() => {
					void this.plugin.jumpToSuggestionAnchor(suggestion.id);
					this.closeJumpMenu();
				},
				{
					disabled: !this.plugin.canJumpToSuggestionAnchor(suggestion.id),
					icon: "link",
					iconOnly: true,
					tooltip: "Jump to the destination",
				},
			);
		}
	}

	private toggleReviewerMenu(suggestion: ReviewSuggestion): void {
		if (this.reviewerMenuSuggestionId === suggestion.id) {
			this.closeReviewerMenu();
			return;
		}

		this.reviewerMenuSuggestionId = suggestion.id;
		this.reviewerPickerValue =
			suggestion.contributor.suggestedReviewerIds[0] ??
			this.plugin.getSortedReviewerProfiles()[0]?.id ??
			null;
		this.reviewerMenuAction = null;
		this.jumpMenuSuggestionId = null;
		this.render();
	}

	private closeReviewerMenu(): void {
		this.reviewerMenuSuggestionId = null;
		this.reviewerMenuAction = null;
		this.reviewerPickerValue = null;
		this.render();
	}

	private toggleJumpMenu(suggestionId: string): void {
		this.jumpMenuSuggestionId = this.jumpMenuSuggestionId === suggestionId ? null : suggestionId;
		if (this.jumpMenuSuggestionId) {
			this.reviewerMenuSuggestionId = null;
			this.reviewerMenuAction = null;
			this.reviewerPickerValue = null;
		}
		this.render();
	}

	private closeJumpMenu(): void {
		this.jumpMenuSuggestionId = null;
		this.render();
	}

	private needsReviewerMenu(suggestion: ReviewSuggestion): boolean {
		return (
			suggestion.contributor.resolutionStatus === "suggested" ||
			suggestion.contributor.resolutionStatus === "unresolved" ||
			suggestion.contributor.resolutionStatus === "new" ||
			this.plugin.canSaveReviewerAlias(suggestion.id)
		);
	}

	private hasAnyJumpTarget(suggestionId: string): boolean {
		return (
			this.plugin.canJumpToSuggestionTarget(suggestionId) ||
			this.plugin.canJumpToSuggestionSource(suggestionId) ||
			this.plugin.canJumpToSuggestionAnchor(suggestionId)
		);
	}

	private getSuggestionReason(suggestion: ReviewSuggestion): string {
		if (this.isOtherTextSuggestion(suggestion)) {
			const session = this.plugin.getCurrentReviewSession();
			const unitLabel = this.plugin.usesSceneTerminology(session?.notePath) ? "scene" : "note";
			if (suggestion.operation === "cut") {
				return `This line may already have been removed or rewritten in this ${unitLabel}.`;
			}
			return `This revision note now applies elsewhere in this ${unitLabel}.`;
		}

		return getOperationSuggestionReason(suggestion);
	}

	private renderCopyBlock(parent: HTMLElement, title: string, body: string): void {
		const wrapper = parent.createDiv({
			cls: `editorialist-suggestion__copy-block editorialist-suggestion__copy-block--${title.toLowerCase()}`,
		});
		if (title.toLowerCase() === "revised") {
			wrapper.addClass("is-copyable");
			wrapper.setAttribute("role", "button");
			wrapper.setAttribute("tabindex", "0");
			this.bindImmediateAction(wrapper, () => {
				void this.plugin.copyTextToClipboard(body, "Revised text copied", "Could not copy the revised text.");
			});
		}
		const heading = wrapper.createEl("strong", { text: title.toUpperCase() });
		if (title.toLowerCase() === "revised") {
			heading.createSpan({
				cls: "editorialist-suggestion__copy-hint",
				text: "Click to copy",
			});
		}
		wrapper.createDiv({ cls: "editorialist-suggestion__copy-body", text: body });
	}

	private getSuggestionReasonTone(suggestion: ReviewSuggestion): "alert" | "muted" {
		const reason = this.getSuggestionReason(suggestion).toLowerCase();
		if (
			reason.includes("no exact match") ||
			reason.includes("not found") ||
			reason.includes("multiple") ||
			reason.includes("ambiguous") ||
			reason.includes("unresolved")
		) {
			return "alert";
		}

		return "muted";
	}

	private getVisualStatusName(suggestion: ReviewSuggestion): ReviewSuggestion["status"] {
		if (this.isImplicitlyAcceptedSuggestion(suggestion)) {
			return "accepted";
		}

		return suggestion.status;
	}

	private getVisualTone(suggestion: ReviewSuggestion): "active" | "muted" {
		if (this.isImplicitlyAcceptedSuggestion(suggestion)) {
			return "active";
		}

		return this.plugin.getSuggestionPresentationTone(suggestion);
	}

	private getSuggestionReasonIcon(suggestion: ReviewSuggestion): string {
		return this.getSuggestionReasonTone(suggestion) === "alert" ? "alert-triangle" : "square-check";
	}

	private centerCardInScrollView(card: HTMLElement): void {
		const scrollParent = this.getScrollParent(card);
		if (!scrollParent) {
			card.scrollIntoView({
				block: "center",
				inline: "nearest",
			});
			return;
		}

		const parentRect = scrollParent.getBoundingClientRect();
		const cardRect = card.getBoundingClientRect();
		const delta = cardRect.top - parentRect.top - (parentRect.height - cardRect.height) / 2;
		const nextTop = Math.max(
			0,
			Math.min(
				scrollParent.scrollHeight - scrollParent.clientHeight,
				scrollParent.scrollTop + delta,
			),
		);

		scrollParent.scrollTo({
			top: nextTop,
			behavior: "auto",
		});
	}

	private getScrollParent(element: HTMLElement): HTMLElement | null {
		let current: HTMLElement | null = element.parentElement;
		while (current) {
			const style = getComputedStyle(current);
			const overflowY = style.overflowY;
			if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) {
				return current;
			}
			current = current.parentElement;
		}

		return null;
	}

	private async handleReviewerMenuAction(suggestion: ReviewSuggestion, value: string): Promise<void> {
		if (value === "assign") {
			this.reviewerMenuAction = "assign";
			this.render();
			return;
		}

		if (value === "create") {
			await this.plugin.createReviewerFromSuggestion(suggestion.id);
			this.closeReviewerMenu();
			return;
		}

		if (value === "unresolved") {
			this.plugin.leaveReviewerUnresolved(suggestion.id);
			this.closeReviewerMenu();
			return;
		}

		if (value === "save_alias") {
			await this.plugin.saveReviewerAliasForSuggestion(suggestion.id);
			this.closeReviewerMenu();
			return;
		}

		this.reviewerMenuAction = null;
		this.render();
	}

	private renderControlButton(
		parent: HTMLElement,
		label: string,
		onClick: () => void,
		options?: {
			active?: boolean;
			disabled?: boolean;
			icon?: string;
			iconOnly?: boolean;
			tooltip?: string;
			trailingIcon?: string;
		},
	): HTMLElement {
		const accessibleLabel = options?.tooltip ?? label;
		const button = parent.createEl("button", {
			cls: "editorialist-suggestion__control",
			attr: {
				type: "button",
				"aria-label": accessibleLabel,
			},
		});
		if (options?.iconOnly) {
			button.addClass("editorialist-suggestion__control--icon-only");
		}
		if (options?.active) {
			button.addClass("is-active");
		}
		if (options?.disabled) {
			button.disabled = true;
		}
		if (options?.icon) {
			const leadingIcon = button.createSpan({ cls: "editorialist-suggestion__control-icon" });
			setIcon(leadingIcon, options.icon);
		}
		if (!options?.iconOnly) {
			button.createSpan({
				cls: "editorialist-suggestion__control-label",
				text: label,
			});
		}
		if (options?.trailingIcon) {
			const trailingIcon = button.createSpan({ cls: "editorialist-suggestion__control-chevron" });
			setIcon(trailingIcon, options.trailingIcon);
		}
		this.bindImmediateAction(button, onClick);
		return button;
	}

	private bindImmediateAction(element: HTMLElement, onClick: () => void): void {
		bindImmediateAction(element, () => onClick(), { guardInteractiveDescendants: true });
	}

	// ── IdleSectionsHost implementation ──────────────────────────────────
	// Public surface that ReviewPanelIdleSections.ts reaches through. Each
	// method is a thin shim over existing private state; behavior is
	// identical to the inline access patterns used before the extraction.

	bindAction(element: HTMLElement, onClick: () => void): void {
		this.bindImmediateAction(element, onClick);
	}

	requestRender(): void {
		this.render();
	}

	getOnboardingExpanded(): boolean | null {
		return this.onboardingExpanded;
	}

	setOnboardingExpanded(value: boolean): void {
		this.onboardingExpanded = value;
	}

	getPendingEditsExpanded(): boolean {
		return this.pendingEditsExpanded;
	}

	setPendingEditsExpanded(value: boolean): void {
		this.pendingEditsExpanded = value;
	}

	private getFilteredSuggestions(suggestions: ReviewSuggestion[]): ReviewSuggestion[] {
		return [...suggestions]
			.filter((suggestion) => {
				if (this.reviewerFilterId && suggestion.contributor.reviewerId !== this.reviewerFilterId) {
					return false;
				}

				if (this.starredOnly && !this.plugin.getReviewerProfile(suggestion.contributor.reviewerId)?.isStarred) {
					return false;
				}

				return true;
			})
			.sort((left, right) => this.compareSuggestions(left, right));
	}

	private compareSuggestions(left: ReviewSuggestion, right: ReviewSuggestion): number {
		const leftProfile = this.plugin.getReviewerProfile(left.contributor.reviewerId);
		const rightProfile = this.plugin.getReviewerProfile(right.contributor.reviewerId);
		const leftStarred = Boolean(leftProfile?.isStarred);
		const rightStarred = Boolean(rightProfile?.isStarred);

		if (leftStarred !== rightStarred) {
			return leftStarred ? -1 : 1;
		}

		const leftName = leftProfile?.displayName ?? left.contributor.displayName;
		const rightName = rightProfile?.displayName ?? right.contributor.displayName;
		const nameOrder = leftName.localeCompare(rightName);
		if (nameOrder !== 0) {
			return nameOrder;
		}

		if (left.source.blockIndex !== right.source.blockIndex) {
			return left.source.blockIndex - right.source.blockIndex;
		}

		return left.source.entryIndex - right.source.entryIndex;
	}

	private isRawOpenSuggestionStatus(status: ReviewSuggestion["status"]): boolean {
		return status === "pending" || status === "deferred" || status === "unresolved";
	}

	private getStatusLabel(suggestion: ReviewSuggestion): string {
		const status = this.getEffectiveStatus(suggestion);
		if (status === "accepted") {
			// Distinguish acceptance the user clicked through from acceptance the
			// engine inferred ("the original isn't here anymore — must already
			// have been handled"). The implicit case gets the "Already X" framing
			// the author asked for; the explicit case keeps the active verb.
			if (this.isImplicitlyAcceptedSuggestion(suggestion)) {
				switch (suggestion.operation) {
					case "edit":
						return "Already revised";
					case "cut":
						return "Already removed";
					case "condense":
						return "Already revised";
					case "expand":
						return "Already expanded";
					case "move":
						return "Already moved";
				}
			}
			switch (suggestion.operation) {
				case "edit":
					return "Edited";
				case "cut":
					return "Text removed";
				case "condense":
					return "Condensed";
				case "expand":
					return "Expanded";
				case "move":
					return "Moved";
			}
		}

		if (status === "rejected") {
			return "Rejected";
		}

		if (status === "rewritten") {
			return "Rewritten";
		}

		if (this.isOtherTextSuggestion(suggestion)) {
			// The original/target text the AI named doesn't appear in the
			// manuscript. Most often the author has already revised that
			// passage; surface that framing per operation rather than the
			// old catch-all "Other text" pill.
			switch (suggestion.operation) {
				case "edit":
					return "Already revised";
				case "cut":
					return "Already removed";
				case "condense":
					return "Already revised";
				case "expand":
					// Target text isn't in the manuscript. Unlike an already-applied
					// match, we can't claim it was expanded — advisory expands often
					// have no suggestion to detect, so an absent target just means we
					// couldn't locate the passage.
					return "Passage not located";
				case "move":
					return "Source missing";
			}
		}

		return this.toSentenceCase(status);
	}

	private getEffectiveStatus(suggestion: ReviewSuggestion): ReviewSuggestion["status"] {
		return getEffectiveSuggestionStatus(suggestion);
	}

	private isImplicitlyAcceptedSuggestion(suggestion: ReviewSuggestion): boolean {
		return isImplicitlyAcceptedSuggestion(suggestion);
	}

	private isOtherTextSuggestion(suggestion: ReviewSuggestion): boolean {
		if (!this.isRawOpenSuggestionStatus(suggestion.status)) {
			return false;
		}

		if (
			this.plugin.canJumpToSuggestionTarget(suggestion.id) ||
			this.plugin.canJumpToSuggestionAnchor(suggestion.id)
		) {
			return false;
		}

		const target = suggestion.location.primary ?? suggestion.location.target;
		return target?.matchType === "none" || target?.reason?.toLowerCase().includes("not found") === true;
	}

	private toSentenceCase(value: string): string {
		return value.charAt(0).toUpperCase() + value.slice(1);
	}

	private getOperationIcon(suggestion: ReviewSuggestion): string {
		switch (suggestion.operation) {
			case "edit":
				return "file-pen-line";
			case "cut":
				return "scissors-line-dashed";
			case "condense":
				return "minimize-2";
			case "expand":
				return "maximize-2";
			case "move":
				return "arrow-right-left";
		}
	}

	private getSourceLabel(suggestion: ReviewSuggestion): string {
		return formatContributorIdentityLabel(suggestion.contributor);
	}
}
