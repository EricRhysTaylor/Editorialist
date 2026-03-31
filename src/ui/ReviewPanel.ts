import { ButtonComponent, DropdownComponent, ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { formatContributorIdentityLabel } from "../core/ContributorIdentity";
import { getSuggestionCopyBlocks, getSuggestionReason as getOperationSuggestionReason, isMoveSuggestion } from "../core/OperationSupport";
import type { ReviewSuggestion } from "../models/ReviewSuggestion";
import type EditorialistPlugin from "../main";

export const REVIEW_PANEL_VIEW_TYPE = "editorialist-review-panel";

type ReviewerMenuAction = "assign" | "create" | "unresolved" | "save_alias";

export class ReviewPanel extends ItemView {
	private jumpMenuSuggestionId: string | null = null;
	private reviewerFilterId: string | null = null;
	private reviewerMenuSuggestionId: string | null = null;
	private reviewerMenuAction: ReviewerMenuAction | null = null;
	private reviewerPickerValue: string | null = null;
	private starredOnly = false;

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
		return "list-todo";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	render(): void {
		const { session, selectedSuggestionId } = this.plugin.store.getState();
		this.contentEl.empty();
		this.contentEl.addClass("editorialist-panel");

		const header = this.contentEl.createDiv({ cls: "editorialist-panel__header" });
		const titleRow = header.createDiv({ cls: "editorialist-panel__title-row" });
		const titleIcon = titleRow.createSpan({ cls: "editorialist-panel__title-icon" });
		setIcon(titleIcon, "list-todo");
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

		const completedSweep = this.plugin.getCompletedSweepPanelState();
		if (completedSweep) {
			this.contentEl.createDiv({ cls: "editorialist-panel__divider" });
			this.renderCompletedSweepCard(completedSweep);
			return;
		}

		if (!session) {
			const postCompletionIdle = this.plugin.getPostCompletionIdleState();
			if (postCompletionIdle) {
				this.contentEl.createDiv({ cls: "editorialist-panel__divider" });
				this.renderIdleStateCard(postCompletionIdle);
				return;
			}

			const launchTarget = this.plugin.getNextLogicalReviewLaunchTarget();
			const actionStrip = header.createDiv({
				cls: `editorialist-panel__launch-strip${launchTarget ? " editorialist-panel__launch-strip--continuation" : ""}`,
			});

			if (launchTarget) {
				const next = actionStrip.createDiv({
					cls: "editorialist-panel__launch-section editorialist-panel__launch-section--next editorialist-panel__launch-section--next-primary",
				});
				const nextLine = next.createDiv({ cls: "editorialist-panel__launch-target editorialist-panel__launch-target--primary" });
				nextLine.createSpan({
					cls: "editorialist-panel__launch-target-prefix editorialist-panel__launch-target-prefix--primary",
					text: `→ ${launchTarget.intent === "active" ? `Active ${launchTarget.unitLabel}` : `Next ${launchTarget.unitLabel}`} `,
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
			}

			const intro = actionStrip.createDiv({ cls: "editorialist-panel__launch-section editorialist-panel__launch-section--intro" });
			const sentence = intro.createDiv({ cls: "editorialist-panel__empty editorialist-panel__launch-copy" });
			if (launchTarget) {
				sentence.appendText("Continue revision sweep or use ");
				const shortcut = sentence.createSpan({ cls: "editorialist-panel__command-shortcut" });
				shortcut.createEl("kbd", { text: "⌘" });
				shortcut.createEl("kbd", { text: "P" });
				sentence.appendText(" to open ");
			} else {
				sentence.appendText("Use ");
				const shortcut = sentence.createSpan({ cls: "editorialist-panel__command-shortcut" });
				shortcut.createEl("kbd", { text: "⌘" });
				shortcut.createEl("kbd", { text: "P" });
				sentence.appendText(" to open ");
			}
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
			sentence.appendText(launchTarget ? " for further options." : " to import and review a new batch.");
			return;
		}

		const headerDetails = this.plugin.getReviewPanelHeaderDetails();
		header.createDiv({
			cls: "editorialist-panel__summary",
			text: headerDetails.summary,
		});
		if (headerDetails.warnings.length > 0) {
			const warningBox = header.createDiv({ cls: "editorialist-panel__warnings" });
			warningBox.createDiv({
				cls: "editorialist-panel__warnings-title",
				text: "Attention",
			});
			const warningList = warningBox.createDiv({ cls: "editorialist-panel__warnings-list" });
			headerDetails.warnings.forEach((warning) => {
				const item = warningList.createDiv({ cls: "editorialist-panel__warning" });
				const icon = item.createSpan({ cls: "editorialist-panel__warning-icon" });
				setIcon(icon, "alert-triangle");
				item.createSpan({
					cls: "editorialist-panel__warning-text",
					text: warning.replace(/^Warning:\s*/i, ""),
				});
			});
		}

		if (session.suggestions.length === 0) {
			this.contentEl.createDiv({
				cls: "editorialist-panel__empty",
				text: "Formatted revision notes found, but no valid entries were parsed.",
			});
			return;
		}

		const handoff = this.plugin.getGuidedSweepHandoffState();
		if (handoff) {
			this.contentEl.createDiv({ cls: "editorialist-panel__divider" });
			this.renderSweepHandoffCard(handoff);
			return;
		}

		const panelOnlyState = this.plugin.getPanelOnlyReviewState();
		if (panelOnlyState) {
			this.contentEl.createDiv({ cls: "editorialist-panel__divider" });
			this.renderPanelOnlyState(panelOnlyState);
		}

		if (this.shouldShowReviewerFilters(session.suggestions)) {
			this.contentEl.createDiv({ cls: "editorialist-panel__divider" });
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
		setIcon(bgIcon, "list-todo");

		const titleRow = card.createDiv({ cls: "editorialist-panel__completion-title-row" });
		const titleIcon = titleRow.createSpan({ cls: "editorialist-panel__completion-title-icon" });
		setIcon(titleIcon, "list-todo");
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
		setIcon(bgIcon, "list-todo");

		const titleRow = card.createDiv({ cls: "editorialist-panel__completion-title-row" });
		const titleIcon = titleRow.createSpan({ cls: "editorialist-panel__completion-title-icon" });
		setIcon(titleIcon, "list-todo");
		titleRow.createSpan({
			cls: "editorialist-panel__completion-title",
			text: postCompletionIdle.title,
		});

		card.createDiv({
			cls: "editorialist-panel__completion-summary",
			text: "No active revision pass right now",
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

		const passStep = steps.createDiv({ cls: "editorialist-panel__completion-step" });
		const passBullet = passStep.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
		setIcon(passBullet, "arrow-right");
		passStep.createSpan({
			cls: "editorialist-panel__completion-step-text",
			text: "Start another pass when you are ready.",
		});

		const operationsStep = steps.createDiv({ cls: "editorialist-panel__completion-step" });
		const operationsBullet = operationsStep.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
		setIcon(operationsBullet, "arrow-right");
		operationsStep.createSpan({
			cls: "editorialist-panel__completion-step-text",
			text: "Review line edits, moves, cuts, and condenses in context.",
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
		setIcon(titleIcon, "list-todo");
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
		const statusName = suggestion.status;
		const tone = this.plugin.getSuggestionPresentationTone(suggestion);
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
		if (panelPrimary) {
			const panelFocus = metaPrimary.createDiv({ cls: "editorialist-suggestion__panel-focus" });
			const panelFocusIcon = panelFocus.createSpan({ cls: "editorialist-suggestion__panel-focus-icon" });
			setIcon(panelFocusIcon, "list-todo");
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
				tooltip: this.getSourceLabel(suggestion),
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
					tooltip: "Mark as rewritten",
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

		this.renderStructureBlock(sourceColumn, "Move this text", suggestion.payload.target, {
			accent: "source",
			icon: "arrow-right-left",
			tone: "ghost",
		});

		const bridgeIcon = bridge.createSpan({ cls: "editorialist-suggestion__structure-bridge-icon" });
		setIcon(bridgeIcon, "arrow-right");
		bridge.createSpan({
			cls: "editorialist-suggestion__structure-bridge-text",
			text: suggestion.payload.placement === "after" ? "Place it after this" : "Place it before this",
		});

		this.renderStructureBlock(destinationColumn, "Place it before this", suggestion.payload.anchor, {
			accent: "anchor",
			icon: "map-pin",
			tone: "muted",
		});
	}

	private renderDeleteStructure(parent: HTMLElement, label: string, text: string): void {
		const structure = parent.createDiv({
			cls: "editorialist-suggestion__structure editorialist-suggestion__structure--delete",
		});
		this.renderStructureBlock(structure, label, text, {
			icon: "scissors",
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
			icon: string;
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
		const header = block.createDiv({ cls: "editorialist-suggestion__structure-block-header" });
		const icon = header.createSpan({ cls: "editorialist-suggestion__structure-block-icon" });
		setIcon(icon, options.icon);
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
		block.createDiv({
			cls: "editorialist-suggestion__structure-block-body",
			text,
		});
	}

	private getCollapsedPreview(suggestion: ReviewSuggestion): string {
		if (this.isOtherTextSuggestion(suggestion)) {
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
		return suggestion.status === "pending" || suggestion.status === "deferred" || suggestion.status === "unresolved";
	}

	private getStatusLabel(suggestion: ReviewSuggestion): string {
		return this.isOtherTextSuggestion(suggestion) ? "Other text" : this.toSentenceCase(suggestion.status);
	}

	private isOtherTextSuggestion(suggestion: ReviewSuggestion): boolean {
		if (!this.isOpenSuggestion(suggestion)) {
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
				return "scissors";
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
