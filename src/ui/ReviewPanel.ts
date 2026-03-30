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
		return "Editorial review";
	}

	getIcon(): string {
		return "check-square";
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
		titleRow.createEl("h2", { text: "Editorial review" });
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

		if (!session) {
			const actionStrip = header.createDiv({ cls: "editorialist-panel__launch-strip" });
			const intro = actionStrip.createDiv({ cls: "editorialist-panel__launch-section editorialist-panel__launch-section--intro" });
			const sentence = intro.createDiv({ cls: "editorialist-panel__empty" });
			sentence.appendText("Import formatted revision notes using ");
			const launchLink = sentence.createEl("a", {
				cls: "editorialist-panel__command-link",
				attr: {
					href: "#",
					title: "Open Editorialist begin",
				},
			});
			launchLink.createSpan({
				cls: "editorialist-panel__command-name",
				text: "Editorialist begin",
			});
			this.bindImmediateAction(launchLink, () => {
				void this.plugin.openEditorialistModal();
			});
			sentence.appendText(", or continue your existing revision workflow.");
			const shortcut = sentence.createSpan({ cls: "editorialist-panel__command-shortcut" });
			shortcut.createSpan({ cls: "editorialist-panel__command-shortcut-label", text: "Shortcut" });
			shortcut.createEl("kbd", { text: "⌘" });
			shortcut.createEl("kbd", { text: "P" });

			const launchTarget = this.plugin.getNextLogicalReviewLaunchTarget();
			if (launchTarget) {
				actionStrip.createDiv({ cls: "editorialist-panel__launch-divider" });
				const next = actionStrip.createDiv({ cls: "editorialist-panel__launch-section editorialist-panel__launch-section--next" });
				const nextLine = next.createDiv({ cls: "editorialist-panel__launch-target" });
				nextLine.createSpan({
					cls: "editorialist-panel__launch-target-prefix",
					text: `→ Next ${launchTarget.unitLabel} `,
				});
				const nextLink = nextLine.createEl("a", {
					cls: "editorialist-panel__launch-target-link",
					attr: {
						href: "#",
						title: `Open ${launchTarget.label}`,
					},
				});
				nextLink.createSpan({
					cls: "editorialist-panel__launch-target-text",
					text: launchTarget.label,
				});
				this.bindImmediateAction(nextLink, () => {
					void this.plugin.startOrResumeReviewForNote(launchTarget.notePath);
				});
			}
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
				text: `Up next: ${handoff.nextLabel}`,
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
		setIcon(titleIcon, "panel-right-open");
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
		this.renderControlButton(
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

		this.renderSuggestionCopy(card, suggestion);

		const reason = card.createDiv({
			cls: `editorialist-suggestion__reason editorialist-suggestion__reason--${this.getSuggestionReasonTone(suggestion)}`,
		});
		const reasonIcon = reason.createSpan({ cls: "editorialist-suggestion__reason-icon" });
		setIcon(reasonIcon, this.getSuggestionReasonIcon(suggestion));
		reason.createSpan({
			cls: "editorialist-suggestion__reason-text",
			text: this.getSuggestionReason(suggestion),
		});

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

	private renderSuggestionCopy(parent: HTMLElement, suggestion: ReviewSuggestion): void {
		const copy = parent.createDiv({ cls: "editorialist-suggestion__copy" });
		getSuggestionCopyBlocks(suggestion).forEach((block) => {
			this.renderCopyBlock(copy, block.label, block.body);
		});
		if (suggestion.why) {
			this.renderCopyBlock(copy, "WHY", suggestion.why);
		}
	}

	private getCollapsedPreview(suggestion: ReviewSuggestion): string {
		if (this.isOtherTextSuggestion(suggestion)) {
			return "Other text in scene";
		}

		switch (suggestion.operation) {
			case "edit":
				return suggestion.payload.revised;
			case "cut":
				return suggestion.payload.target;
			case "condense":
				return suggestion.payload.suggestion ?? suggestion.payload.target;
			case "move":
				return suggestion.payload.target;
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
			return "This revision note now points to other text in the scene.";
		}

		return getOperationSuggestionReason(suggestion);
	}

	private renderCopyBlock(parent: HTMLElement, title: string, body: string): void {
		const wrapper = parent.createDiv({
			cls: `editorialist-suggestion__copy-block editorialist-suggestion__copy-block--${title.toLowerCase()}`,
		});
		wrapper.createEl("strong", { text: title.toUpperCase() });
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
	): void {
		const button = parent.createEl("button", {
			cls: "editorialist-suggestion__control",
			attr: {
				type: "button",
				title: options?.tooltip ?? label,
				"aria-label": options?.tooltip ?? label,
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
	}

	private bindImmediateAction(element: HTMLElement, onClick: () => void): void {
		let handledPointerDown = false;

		element.addEventListener("pointerdown", (event) => {
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
				return "pencil";
			case "cut":
				return "scissors";
			case "condense":
				return "minimize-2";
			case "move":
				return "arrow-right-left";
		}
	}

	private getSourceLabel(suggestion: ReviewSuggestion): string {
		return `Contributor: ${formatContributorIdentityLabel(suggestion.contributor)}`;
	}
}
