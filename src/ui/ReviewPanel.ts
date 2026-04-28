import { ButtonComponent, DropdownComponent, ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { formatContributorIdentityLabel, formatReviewerTypeLabel } from "../core/ContributorIdentity";
import { getEffectiveSuggestionStatus, getSuggestionCopyBlocks, getSuggestionReason as getOperationSuggestionReason, isImplicitlyAcceptedCutSuggestion, isMoveSuggestion } from "../core/OperationSupport";
import type { ReviewSweepStatus } from "../models/ReviewImport";
import type { ReviewSuggestion, SceneMemo } from "../models/ReviewSuggestion";
import EditorialistPlugin, { type ReviewStateIndexEntry, type ReviewStateOverview } from "../main";

export const REVIEW_PANEL_VIEW_TYPE = "editorialist-review-panel";

type ReviewerMenuAction = "assign" | "create" | "unresolved" | "save_alias";

export class ReviewPanel extends ItemView {
	private jumpMenuSuggestionId: string | null = null;
	private reviewerFilterId: string | null = null;
	private reviewerMenuSuggestionId: string | null = null;
	private reviewerMenuAction: ReviewerMenuAction | null = null;
	private reviewerPickerValue: string | null = null;
	private starredOnly = false;
	private reviewStateProcessedExpanded = false;

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
		const { session, selectedSuggestionId } = this.plugin.store.getState();
		this.contentEl.empty();
		this.contentEl.addClass("editorialist-panel");

		const completedSweep = this.plugin.getCompletedSweepPanelState();
		const postCompletionIdle = !session && !completedSweep ? this.plugin.getPostCompletionIdleState() : null;
		const launchTarget = !session && !completedSweep && !postCompletionIdle
			? this.plugin.getNextLogicalReviewLaunchTarget()
			: null;
		const isColdIdle = !session && !completedSweep && !postCompletionIdle && !launchTarget;

		const header = this.contentEl.createDiv({ cls: "editorialist-panel__header" });
		const titleRow = header.createDiv({ cls: "editorialist-panel__title-row" });
		const titleIcon = titleRow.createSpan({ cls: "editorialist-panel__title-icon" });
		setIcon(titleIcon, "pen-tool");
		titleRow.createEl("h2", { text: "Editorialist review" });

		if (isColdIdle) {
			this.renderHeaderLauncherChip(titleRow);
		}

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
			this.renderCompletedSweepCard(completedSweep);
			return;
		}

		if (!session) {
			if (postCompletionIdle) {
				this.renderIdleStateCard(postCompletionIdle);
				return;
			}

			if (launchTarget) {
				const actionStrip = header.createDiv({
					cls: "editorialist-panel__launch-strip editorialist-panel__launch-strip--continuation",
				});

				const next = actionStrip.createDiv({
					cls: "editorialist-panel__launch-section editorialist-panel__launch-section--next editorialist-panel__launch-section--next-primary",
				});
				const nextLine = next.createDiv({ cls: "editorialist-panel__launch-target editorialist-panel__launch-target--primary" });
				nextLine.createSpan({
					cls: "editorialist-panel__launch-target-prefix editorialist-panel__launch-target-prefix--primary",
					text: `→ ${launchTarget.intent === "active" ? `Resume ${launchTarget.unitLabel}` : `Next ${launchTarget.unitLabel}`} `,
				});
				const nextLink = nextLine.createEl("a", {
					cls: "editorialist-panel__launch-target-link",
					attr: {
						href: "#",
						title: `Open ${launchTarget.label}`,
					},
				});
				nextLink.createSpan({
					cls: "editorialist-panel__launch-target-text editorialist-panel__launch-target-text--primary",
					text: launchTarget.label,
				});
				this.bindImmediateAction(nextLink, () => {
					void this.plugin.startOrResumeReviewForNote(launchTarget.notePath);
				});

				actionStrip.createDiv({ cls: "editorialist-panel__launch-divider" });

				const intro = actionStrip.createDiv({ cls: "editorialist-panel__launch-section editorialist-panel__launch-section--intro" });
				const sentence = intro.createDiv({ cls: "editorialist-panel__empty editorialist-panel__launch-copy" });
				sentence.appendText("Continue revision sweep or use ");
				const shortcut = sentence.createSpan({ cls: "editorialist-panel__command-shortcut" });
				shortcut.createEl("kbd", { text: "⌘" });
				shortcut.createEl("kbd", { text: "P" });
				sentence.appendText(" to open ");
				const launchLink = sentence.createEl("a", {
					cls: "editorialist-panel__command-link",
					attr: {
						href: "#",
						title: "Open the Editorialist launcher",
					},
				});
				launchLink.createSpan({
					cls: "editorialist-panel__command-name",
					text: "Open review launcher",
				});
				this.bindImmediateAction(launchLink, () => {
					void this.plugin.openEditorialistModal();
				});
				sentence.appendText(" for further options.");
			} else {
				this.renderColdIdleBody(this.contentEl);
			}

			const overview = this.plugin.getReviewStateOverview();
			if (overview) {
				this.renderReviewStateCard(overview);
			}
			return;
		}

		const headerDetails = this.plugin.getReviewPanelHeaderDetails();
		header.createDiv({
			cls: "editorialist-panel__summary",
			text: headerDetails.summary,
		});

		const memos = session.memos ?? [];
		const pendingEditsCount = this.plugin.getPendingEditsCountForScene(session.notePath);
		this.renderCommentsCard(memos, pendingEditsCount, session.notePath);

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

		if (this.shouldShowReviewerFilters(session.suggestions)) {
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
			? this.getPanelPrimarySuggestionId(filteredSuggestions, selectedSuggestionId)
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
			requestAnimationFrame(() => {
				if (document.body.contains(targetCard)) {
					this.centerCardInScrollView(targetCard);
				}
			});
		}
	}

	private renderCompletedSweepCard(completedSweep: ReturnType<EditorialistPlugin["getCompletedSweepPanelState"]>): void {
		if (!completedSweep) {
			return;
		}

		const card = this.contentEl.createDiv({ cls: "editorialist-panel__completion" });
		const bgIcon = card.createSpan({ cls: "editorialist-panel__completion-bg-icon" });
		setIcon(bgIcon, "pen-tool");

		const titleRow = card.createDiv({ cls: "editorialist-panel__completion-title-row" });
		const titleIcon = titleRow.createSpan({ cls: "editorialist-panel__completion-title-icon" });
		setIcon(titleIcon, "pen-tool");
		titleRow.createSpan({
			cls: "editorialist-panel__completion-title",
			text: completedSweep.title,
		});

		card.createDiv({
			cls: "editorialist-panel__completion-summary",
			text: completedSweep.editsReviewedLabel,
		});
		if (completedSweep.durationLabel) {
			card.createDiv({
				cls: "editorialist-panel__completion-duration",
				text: completedSweep.durationLabel,
			});
		}
		card.createDiv({
			cls: "editorialist-panel__completion-description",
			text: completedSweep.description,
		});

		const steps = card.createDiv({ cls: "editorialist-panel__completion-steps" });
		completedSweep.nextSteps.forEach((step, index) => {
			const item = steps.createDiv({ cls: "editorialist-panel__completion-step" });
			if (index === 0) {
				item.addClass("is-primary");
			}
			const bullet = item.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
			setIcon(bullet, "arrow-right");

			if (step.action === "import") {
				const link = item.createEl("a", {
					cls: "editorialist-panel__completion-step-link",
					attr: {
						href: "#",
						title: step.label,
					},
				});
				link.createSpan({
					cls: "editorialist-panel__completion-link-text",
					text: step.label,
				});
				this.bindImmediateAction(link, () => {
					void this.plugin.openEditorialistModal();
				});
				return;
			}

			if (step.action === "start") {
				const link = item.createEl("a", {
					cls: "editorialist-panel__completion-step-link",
					attr: {
						href: "#",
						title: step.label,
					},
				});
				link.createSpan({
					cls: "editorialist-panel__completion-link-text",
					text: step.label,
				});
				this.bindImmediateAction(link, () => {
					void this.plugin.resumeCompletedReviewMode();
				});
				return;
			}

			if (step.action === "clean") {
				const link = item.createEl("a", {
					cls: "editorialist-panel__completion-step-link",
					attr: {
						href: "#",
						title: step.label,
					},
				});
				link.createSpan({
					cls: "editorialist-panel__completion-link-text",
					text: step.label,
				});
				this.bindImmediateAction(link, () => {
					void this.plugin.cleanupCompletedSweepReviewBlocks();
				});
				return;
			}

			item.createSpan({
				cls: "editorialist-panel__completion-step-text",
				text: step.label,
			});
		});

		const closeRow = card.createDiv({ cls: "editorialist-panel__completion-close" });
		const closeLink = closeRow.createEl("a", {
			cls: "editorialist-panel__completion-close-link",
			attr: {
				href: "#",
				title: completedSweep.closeLabel,
			},
		});
		closeLink.createSpan({ text: "→ " });
		closeLink.createSpan({
			cls: "editorialist-panel__completion-link-text",
			text: completedSweep.closeLabel,
		});
		this.bindImmediateAction(closeLink, () => {
			void this.plugin.closeReviewPanel();
		});
	}

	private renderIdleStateCard(postCompletionIdle: ReturnType<EditorialistPlugin["getPostCompletionIdleState"]>): void {
		if (!postCompletionIdle) {
			return;
		}

		const card = this.contentEl.createDiv({
			cls: "editorialist-panel__completion editorialist-panel__completion--neutral",
		});
		const bgIcon = card.createSpan({ cls: "editorialist-panel__completion-bg-icon" });
		setIcon(bgIcon, "pen-tool");

		card.createDiv({
			cls: "editorialist-panel__completion-summary",
			text: "No active review",
		});
		card.createDiv({
			cls: "editorialist-panel__completion-description",
			text: postCompletionIdle.description,
		});

		const steps = card.createDiv({ cls: "editorialist-panel__completion-steps" });

		const importStep = steps.createDiv({
			cls: "editorialist-panel__completion-step editorialist-panel__completion-step--neutral-primary",
		});
		const importBullet = importStep.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
		setIcon(importBullet, "arrow-right");
		const importLink = importStep.createEl("a", {
			cls: "editorialist-panel__completion-step-link",
			attr: {
				href: "#",
				title: "Open Editorialist begin",
			},
		});
		importLink.createSpan({
			cls: "editorialist-panel__completion-link-text",
			text: "Import new revision notes",
		});
		this.bindImmediateAction(importLink, () => {
			void this.plugin.openEditorialistModal();
		});

		const pendingSummary = this.plugin.getPendingEditsSummary();
		if (pendingSummary && pendingSummary.segmentCount > 0) {
			const pendingStep = steps.createDiv({
				cls: "editorialist-panel__completion-step editorialist-panel__completion-step--active",
			});
			const pendingBullet = pendingStep.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
			setIcon(pendingBullet, "clipboard-list");
			const pendingLink = pendingStep.createEl("a", {
				cls: "editorialist-panel__completion-step-link",
				attr: {
					href: "#",
					title: "Start pending-edits review in active book",
				},
			});
			const itemNoun = pendingSummary.segmentCount === 1 ? "item" : "items";
			const sceneNoun = pendingSummary.sceneCount === 1 ? "scene" : "scenes";
			pendingLink.createSpan({
				cls: "editorialist-panel__completion-link-text",
				text: `Review ${pendingSummary.segmentCount} pending edit ${itemNoun} across ${pendingSummary.sceneCount} ${sceneNoun}`,
			});
			this.bindImmediateAction(pendingLink, () => {
				void this.plugin.startPendingEditsReview();
			});
		}

		const operationsStep = steps.createDiv({ cls: "editorialist-panel__completion-step" });
		const operationsBullet = operationsStep.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
		setIcon(operationsBullet, "arrow-right");
		operationsStep.createSpan({
			cls: "editorialist-panel__completion-step-text",
			text: "Review revision and contributor details in settings.",
		});
	}

	private renderHeaderLauncherChip(parent: HTMLElement): void {
		const chip = parent.createDiv({ cls: "editorialist-panel__launcher-chip" });
		const keys = chip.createSpan({ cls: "editorialist-panel__launcher-chip-keys" });
		keys.createEl("kbd", { text: "⌘" });
		keys.createEl("kbd", { text: "P" });
		const link = chip.createEl("a", {
			cls: "editorialist-panel__launcher-chip-link",
			attr: { href: "#", title: "Open the Editorialist launcher" },
		});
		link.setText("Open review launcher");
		this.bindImmediateAction(link, () => {
			void this.plugin.openEditorialistModal();
		});
	}

	private renderColdIdleBody(parent: HTMLElement): void {
		this.renderWorkflowsBlock(parent);
		this.renderRecentActivityBlock(parent);
		this.renderContributorsBlock(parent);
	}

	private renderWorkflowsBlock(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "editorialist-panel__workflows" });
		const heading = section.createDiv({ cls: "editorialist-panel__section-header" });
		heading.createDiv({ cls: "editorialist-panel__section-title", text: "How to use Editorialist" });
		heading.createDiv({
			cls: "editorialist-panel__section-meta",
			text: "Two passes, one directory",
		});

		const grid = section.createDiv({ cls: "editorialist-panel__workflow-grid" });
		const workflows: Array<{ icon: string; title: string; body: string }> = [
			{
				icon: "download-cloud",
				title: "Imported review pass",
				body: "Pull in contributor notes from a human reader or AI editor, then accept, reject, or rewrite each suggestion in turn.",
			},
			{
				icon: "clipboard-list",
				title: "Pending edits sweep",
				body: "Walk through free-form revision notes you've left across the active book, scene by scene.",
			},
			{
				icon: "users",
				title: "Contributor directory",
				body: "Star trusted reviewers, resolve aliases on imported batches, and track who shaped each draft.",
			},
		];
		for (const wf of workflows) {
			const card = grid.createDiv({ cls: "editorialist-panel__workflow-card" });
			const iconWrap = card.createSpan({ cls: "editorialist-panel__workflow-icon" });
			setIcon(iconWrap, wf.icon);
			const text = card.createDiv({ cls: "editorialist-panel__workflow-text" });
			text.createDiv({ cls: "editorialist-panel__workflow-title", text: wf.title });
			text.createDiv({ cls: "editorialist-panel__workflow-body", text: wf.body });
		}
	}

	private renderRecentActivityBlock(parent: HTMLElement): void {
		const allEntries = this.plugin.getSweepRegistryEntries();
		if (allEntries.length === 0) {
			return;
		}

		const entries = allEntries.slice(0, 5);
		const section = parent.createDiv({ cls: "editorialist-panel__history" });
		const heading = section.createDiv({ cls: "editorialist-panel__section-header" });
		heading.createDiv({ cls: "editorialist-panel__section-title", text: "Recent reviews" });
		heading.createDiv({
			cls: "editorialist-panel__section-meta",
			text: `${allEntries.length} total`,
		});

		const list = section.createDiv({ cls: "editorialist-panel__history-list" });
		for (const entry of entries) {
			const row = list.createDiv({ cls: "editorialist-panel__history-row" });
			const main = row.createDiv({ cls: "editorialist-panel__history-main" });

			const titleText = entry.activeBookLabel?.trim()
				|| entry.currentNotePath?.split("/").pop()?.replace(/\.md$/, "")
				|| entry.importedNotePaths[0]?.split("/").pop()?.replace(/\.md$/, "")
				|| "Review pass";
			main.createDiv({
				cls: "editorialist-panel__history-title",
				text: titleText,
			});

			const metaParts: string[] = [];
			const noteCount = entry.importedNotePaths.length;
			if (noteCount > 0) {
				metaParts.push(`${noteCount} ${noteCount === 1 ? "scene" : "scenes"}`);
			}
			if (entry.totalSuggestions > 0) {
				metaParts.push(`${entry.totalSuggestions} ${entry.totalSuggestions === 1 ? "suggestion" : "suggestions"}`);
			}
			metaParts.push(this.formatRelativeTime(entry.updatedAt));
			main.createDiv({
				cls: "editorialist-panel__history-meta",
				text: metaParts.join(" · "),
			});

			const statusModifier = entry.status.replace(/_/g, "-");
			const status = row.createDiv({
				cls: `editorialist-panel__history-status editorialist-panel__history-status--${statusModifier}`,
			});
			const statusIcon = status.createSpan({ cls: "editorialist-panel__history-status-icon" });
			setIcon(statusIcon, this.getSweepStatusIcon(entry.status));
			status.createSpan({
				cls: "editorialist-panel__history-status-text",
				text: this.getSweepStatusLabel(entry.status),
			});
		}
	}

	private renderContributorsBlock(parent: HTMLElement): void {
		const allProfiles = this.plugin.getSortedReviewerProfiles();
		if (allProfiles.length === 0) {
			return;
		}

		const profiles = allProfiles.slice(0, 5);
		const section = parent.createDiv({ cls: "editorialist-panel__contributors" });
		const heading = section.createDiv({ cls: "editorialist-panel__section-header" });
		heading.createDiv({ cls: "editorialist-panel__section-title", text: "Contributors" });
		heading.createDiv({
			cls: "editorialist-panel__section-meta",
			text: `${allProfiles.length} total`,
		});

		const list = section.createDiv({ cls: "editorialist-panel__contributors-list" });
		for (const profile of profiles) {
			const row = list.createDiv({ cls: "editorialist-panel__contributors-row" });

			const starSlot = row.createSpan({ cls: "editorialist-panel__contributors-star" });
			if (profile.isStarred) {
				starSlot.addClass("is-starred");
				setIcon(starSlot, "star");
			}

			const main = row.createDiv({ cls: "editorialist-panel__contributors-main" });
			main.createDiv({ cls: "editorialist-panel__contributors-name", text: profile.displayName });

			const metaParts: string[] = [formatReviewerTypeLabel(profile.reviewerType)];
			if (profile.kind === "ai" && profile.provider) {
				metaParts.push(profile.provider);
			}
			main.createDiv({
				cls: "editorialist-panel__contributors-meta",
				text: metaParts.join(" · "),
			});

			const stat = profile.stats?.totalSuggestions ?? 0;
			if (stat > 0) {
				row.createDiv({
					cls: "editorialist-panel__contributors-stat",
					text: `${stat} ${stat === 1 ? "edit" : "edits"}`,
				});
			}
		}
	}

	private formatRelativeTime(timestamp: number): string {
		const diff = Date.now() - timestamp;
		if (diff < 60_000) return "just now";
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d ago`;
		const weeks = Math.floor(days / 7);
		if (weeks < 5) return `${weeks}w ago`;
		const months = Math.floor(days / 30);
		if (months < 12) return `${months}mo ago`;
		const years = Math.floor(days / 365);
		return `${years}y ago`;
	}

	private getSweepStatusIcon(status: ReviewSweepStatus): string {
		switch (status) {
			case "in_progress":
				return "circle-dot";
			case "completed":
				return "check-circle-2";
			case "cleaned":
				return "sparkles";
		}
	}

	private getSweepStatusLabel(status: ReviewSweepStatus): string {
		switch (status) {
			case "in_progress":
				return "In progress";
			case "completed":
				return "Done";
			case "cleaned":
				return "Cleaned";
		}
	}

	private renderReviewStateCard(overview: ReviewStateOverview): void {
		const card = this.contentEl.createDiv({ cls: "editorialist-panel__review-state" });

		const header = card.createDiv({ cls: "editorialist-panel__review-state-header" });
		const titleIcon = header.createSpan({ cls: "editorialist-panel__review-state-title-icon" });
		setIcon(titleIcon, "list-checks");
		header.createSpan({
			cls: "editorialist-panel__review-state-title",
			text: "Review state",
		});
		const summaryParts: string[] = [];
		if (overview.pending.length > 0) {
			summaryParts.push(`${overview.pending.length} pending`);
		}
		if (overview.processed.length > 0) {
			summaryParts.push(`${overview.processed.length} ready to clean`);
		}
		if (summaryParts.length > 0) {
			header.createSpan({
				cls: "editorialist-panel__review-state-summary",
				text: summaryParts.join(" · "),
			});
		}

		if (overview.pending.length > 0) {
			this.renderReviewStateGroup(card, "Pending", overview.pending, false);
		}

		if (overview.processed.length > 0) {
			const expanded = this.reviewStateProcessedExpanded;
			this.renderReviewStateGroup(card, "Ready to clean", overview.processed, true, expanded);
		}
	}

	private renderReviewStateGroup(
		parent: HTMLElement,
		label: string,
		entries: ReviewStateIndexEntry[],
		showCleanAction: boolean,
		expanded: boolean = true,
	): void {
		const group = parent.createDiv({ cls: "editorialist-panel__review-state-group" });
		const isCollapsible = showCleanAction;
		const isOpen = !isCollapsible || expanded;

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

		if (!isOpen) {
			return;
		}

		const list = group.createDiv({ cls: "editorialist-panel__review-state-list" });

		const sorted = [...entries].sort((a, b) => b.lastUpdated - a.lastUpdated);
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
			this.bindImmediateAction(cleanButton, async () => {
				await this.plugin.cleanSceneReviewNote(entry.notePath);
				this.render();
			});
		}
	}

	private renderCommentsCard(memos: SceneMemo[], pendingEditsCount: number, notePath: string): void {
		const hasMemos = memos.length > 0;
		const hasPending = pendingEditsCount > 0;
		if (!hasMemos && !hasPending) {
			return;
		}

		const card = this.contentEl.createDiv({ cls: "editorialist-panel__comments" });

		const header = card.createDiv({ cls: "editorialist-panel__comments-header" });
		const titleIcon = header.createSpan({ cls: "editorialist-panel__comments-title-icon" });
		setIcon(titleIcon, "message-square-text");
		header.createSpan({
			cls: "editorialist-panel__comments-title",
			text: "Comments",
		});
		const summaryParts: string[] = [];
		if (hasMemos) {
			summaryParts.push(`${memos.length} memo${memos.length === 1 ? "" : "s"}`);
		}
		if (hasPending) {
			summaryParts.push(`${pendingEditsCount} pending`);
		}
		if (summaryParts.length > 0) {
			header.createSpan({
				cls: "editorialist-panel__comments-summary",
				text: summaryParts.join(" · "),
			});
		}

		const body = card.createDiv({ cls: "editorialist-panel__comments-body" });

		memos.forEach((memo) => {
			this.renderMemoEntry(body, memo);
		});

		if (hasPending) {
			this.renderPendingEditsEntry(body, pendingEditsCount, notePath);
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

	private renderPendingEditsEntry(parent: HTMLElement, count: number, _notePath: string): void {
		const entry = parent.createDiv({ cls: "editorialist-panel__comment-entry editorialist-panel__comment-entry--pending" });

		const header = entry.createDiv({ cls: "editorialist-panel__comment-entry-header" });
		const kindBadge = header.createSpan({ cls: "editorialist-panel__comment-entry-kind" });
		kindBadge.setText("Pending edits");
		header.createSpan({
			cls: "editorialist-panel__comment-entry-contributor",
			text: `${count} item${count === 1 ? "" : "s"} on this scene`,
		});

		const actionRow = entry.createDiv({ cls: "editorialist-panel__comment-entry-action" });
		const link = actionRow.createEl("a", {
			cls: "editorialist-panel__comment-entry-action-link",
			attr: { href: "#", title: "Start a pending-edits review across the active book" },
		});
		link.createSpan({ text: "→ Review pending edits" });
		this.bindImmediateAction(link, () => {
			void this.plugin.startPendingEditsReview();
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

	private shouldShowReviewerFilters(suggestions: ReviewSuggestion[]): boolean {
		const reviewerIds = new Set(
			suggestions
				.map((suggestion) => suggestion.contributor.reviewerId ?? suggestion.contributor.id)
				.filter((value): value is string => Boolean(value)),
		);

		return reviewerIds.size > 1;
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
		if (panelPrimary && this.hasAnyJumpTarget(suggestion.id)) {
			const panelFocus = metaPrimary.createDiv({ cls: "editorialist-suggestion__panel-focus" });
			const panelFocusIcon = panelFocus.createSpan({ cls: "editorialist-suggestion__panel-focus-icon" });
			setIcon(panelFocusIcon, "pen-tool");
			panelFocus.createSpan({
				cls: "editorialist-suggestion__panel-focus-text",
				text: "Continue here",
			});
		}

		const hasReviewerMenu = this.needsReviewerMenu(suggestion);
		const actions = meta.createDiv({ cls: "editorialist-suggestion__actions" });
		const sourceButton = this.renderControlButton(
			actions,
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
		this.renderControlButton(
			actions,
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

		if (this.plugin.canMarkSuggestionRewritten(suggestion.id)) {
			const resolutionActions = card.createDiv({ cls: "editorialist-suggestion__resolution-actions" });
			this.renderControlButton(
				resolutionActions,
				"Mark as rewritten",
				() => {
					void this.plugin.markSuggestionRewritten(suggestion.id);
				},
				{
					icon: "pen-line",
				},
			);
		}

		if (this.reviewerMenuSuggestionId === suggestion.id) {
			this.renderReviewerMenu(card, suggestion);
		}

		if (this.jumpMenuSuggestionId === suggestion.id) {
			this.renderJumpMenu(card, suggestion);
		}

		return card;
	}

	private getPanelPrimarySuggestionId(
		suggestions: ReviewSuggestion[],
		selectedSuggestionId: string | null,
	): string | null {
		if (
			selectedSuggestionId &&
			suggestions.some((suggestion) => suggestion.id === selectedSuggestionId && this.isOpenSuggestion(suggestion))
		) {
			return selectedSuggestionId;
		}

		return suggestions.find((suggestion) => this.isOpenSuggestion(suggestion))?.id ?? null;
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
					"Before",
					suggestion.payload.target,
					"After",
					suggestion.payload.suggestion ?? "Condense this paragraph.",
					true,
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
		isCondense = false,
	): void {
		const structure = parent.createDiv({
			cls: `editorialist-suggestion__structure editorialist-suggestion__structure--comparison${isCondense ? " editorialist-suggestion__structure--condense" : ""}`,
		});
		this.renderStructureBlock(structure, beforeLabel, beforeText, {
			icon: isCondense ? "minimize-2" : "align-left",
			tone: "ghost",
		});
		const bridge = structure.createDiv({ cls: "editorialist-suggestion__structure-bridge" });
		const bridgeIcon = bridge.createSpan({ cls: "editorialist-suggestion__structure-bridge-icon" });
		setIcon(bridgeIcon, isCondense ? "arrow-down" : "arrow-right");
		bridge.createSpan({
			cls: "editorialist-suggestion__structure-bridge-text",
			text: isCondense ? "Condense to this version" : "Replace with this version",
		});
		this.renderStructureBlock(structure, afterLabel, afterText, {
			icon: isCondense ? "sparkles" : "check",
			copyHint: "Click to copy",
			copyNotice: isCondense ? "Suggestion copied" : "Revised text copied",
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
		const placementLabel = suggestion.payload.placement === "after" ? "After this" : "Before this";
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

		const bridgeIcon = bridge.createSpan({ cls: "editorialist-suggestion__structure-bridge-icon" });
		setIcon(bridgeIcon, "arrow-right");

		this.renderStructureMiniHeader(destinationColumn, placementLabel, {
			icon: placementIcon,
			align: "start",
		});
		this.renderStructureBlock(destinationColumn, "", suggestion.payload.anchor, {
			accent: "anchor",
			tone: "muted",
			hideHeader: true,
		});
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
			copyHint?: string;
			copyNotice?: string;
			hideHeader?: boolean;
			icon?: string;
			state?: "insert" | "delete";
			tone: "active" | "ghost" | "muted";
		},
	): void {
		const block = parent.createDiv({
			cls: `editorialist-suggestion__structure-block editorialist-suggestion__structure-block--${options.tone}${options.state ? ` editorialist-suggestion__structure-block--${options.state}` : ""}`,
		});
		if (options.accent) {
			block.addClass(`editorialist-suggestion__structure-block--${options.accent}`);
		}
		if (options.copyHint) {
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
			return "Applies elsewhere";
		}

		switch (suggestion.operation) {
			case "edit":
				return suggestion.payload.revised;
			case "cut":
				return "Remove paragraph";
			case "condense":
				return suggestion.payload.suggestion ?? "Condense paragraph";
			case "move":
				return `Move ${suggestion.payload.placement} anchor`;
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
				tooltip: "Jump to target",
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
				tooltip: "Jump to source",
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
					tooltip: "Jump to anchor",
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
			const session = this.plugin.store.getSession();
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
		if (this.isImplicitlyAcceptedCutSuggestion(suggestion)) {
			return "accepted";
		}

		return suggestion.status;
	}

	private getVisualTone(suggestion: ReviewSuggestion): "active" | "muted" {
		if (this.isImplicitlyAcceptedCutSuggestion(suggestion)) {
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
		let handledPointerDown = false;

		element.addEventListener("pointerdown", (event) => {
			if (element instanceof HTMLButtonElement && element.disabled) {
				return;
			}
			if (this.shouldIgnoreImmediateActionEvent(element, event.target)) {
				return;
			}
			if (event.button !== 0) {
				return;
			}

			handledPointerDown = true;
			event.preventDefault();
			event.stopPropagation();
			onClick();
		});

		element.addEventListener("click", (event) => {
			if (element instanceof HTMLButtonElement && element.disabled) {
				return;
			}
			if (this.shouldIgnoreImmediateActionEvent(element, event.target)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			if (handledPointerDown) {
				handledPointerDown = false;
				return;
			}

			onClick();
		});
	}

	private shouldIgnoreImmediateActionEvent(element: HTMLElement, target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) {
			return false;
		}

		if (target === element) {
			return false;
		}

		const interactiveAncestor = target.closest(
			"button, a, input, select, textarea, summary, [role='button'], [contenteditable='true'], .dropdown",
		);
		return Boolean(interactiveAncestor && interactiveAncestor !== element);
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
		const rankOrder = this.plugin.getSuggestionPresentationRank(left) - this.plugin.getSuggestionPresentationRank(right);
		if (rankOrder !== 0) {
			return rankOrder;
		}

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

	private isOpenSuggestion(suggestion: ReviewSuggestion): boolean {
		const status = this.getEffectiveStatus(suggestion);
		return status === "pending" || status === "deferred" || status === "unresolved";
	}

	private isRawOpenSuggestionStatus(status: ReviewSuggestion["status"]): boolean {
		return status === "pending" || status === "deferred" || status === "unresolved";
	}

	private getStatusLabel(suggestion: ReviewSuggestion): string {
		const status = this.getEffectiveStatus(suggestion);
		if (status === "accepted") {
			switch (suggestion.operation) {
				case "edit":
					return "Edited";
				case "cut":
					return "Text removed";
				case "condense":
					return "Condensed";
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
			if (suggestion.operation === "cut") {
				return "Text removed";
			}
			return "Other text";
		}

		return this.toSentenceCase(status);
	}

	private getEffectiveStatus(suggestion: ReviewSuggestion): ReviewSuggestion["status"] {
		return getEffectiveSuggestionStatus(suggestion);
	}

	private isImplicitlyAcceptedCutSuggestion(suggestion: ReviewSuggestion): boolean {
		return isImplicitlyAcceptedCutSuggestion(suggestion);
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
			case "move":
				return "arrow-right-left";
		}
	}

	private getSourceLabel(suggestion: ReviewSuggestion): string {
		return formatContributorIdentityLabel(suggestion.contributor);
	}
}
