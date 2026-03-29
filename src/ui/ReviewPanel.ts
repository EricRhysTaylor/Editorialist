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

		if (!session) {
			const empty = header.createDiv({ cls: "editorialist-panel__empty" });
			empty.appendText("Run ");
			const shortcut = empty.createSpan({ cls: "editorialist-panel__command-shortcut" });
			shortcut.createEl("kbd", { text: "⌘" });
			shortcut.createEl("kbd", { text: "P" });
			empty.appendText(" ");
			empty.createSpan({
				cls: "editorialist-panel__command-name",
				text: "Editorialist begin",
			});
			empty.appendText(" to get started with a streamlined editing workflow.");
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
				text: "Warnings",
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
				text: "Review block found, but no valid review entries were parsed.",
			});
			return;
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
		filteredSuggestions.forEach((suggestion, index) => {
			const card = this.renderSuggestionCard(
				list,
				suggestion,
				selectedSuggestionId === suggestion.id,
				index,
				filteredSuggestions.length,
			);
			if (selectedSuggestionId === suggestion.id) {
				selectedCard = card;
			}
		});

		if (selectedCard) {
			requestAnimationFrame(() => {
				if (selectedCard?.isConnected) {
					this.centerCardInScrollView(selectedCard);
				}
			});
		}
	}

	private renderFilters(): void {
		const controls = this.contentEl.createDiv({ cls: "editorialist-panel__filters" });
		const filterLabel = controls.createDiv({ cls: "editorialist-panel__filter-label" });
		filterLabel.setText("Reviewer filter");

		const filterControls = controls.createDiv({ cls: "editorialist-panel__filter-controls" });
		const inlineGroup = filterControls.createDiv({ cls: "editorialist-panel__filter-inline-group" });
		const dropdownContainer = inlineGroup.createDiv({ cls: "editorialist-panel__filter-control" });
		const dropdown = new DropdownComponent(dropdownContainer);
		dropdown.addOption("", "All reviewers");
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

	private renderSuggestionCard(
		parent: HTMLElement,
		suggestion: ReviewSuggestion,
		selected: boolean,
		index: number,
		total: number,
	): HTMLElement {
		const visualState = this.plugin.getSuggestionPresentationState(suggestion);

		const card = parent.createDiv({
			cls: `editorialist-suggestion editorialist-review-card editorialist-suggestion--${visualState}${selected ? " is-selected" : ""}`,
		});
		this.bindImmediateAction(card, () => {
			void this.plugin.selectSuggestion(suggestion.id);
		});

		const meta = card.createDiv({ cls: "editorialist-suggestion__meta" });
		const metaPrimary = meta.createDiv({ cls: "editorialist-suggestion__meta-primary" });
		const status = metaPrimary.createDiv({
			cls: `editorialist-suggestion__label editorialist-suggestion__label--${visualState}`,
			attr: {
				title: `${this.toSentenceCase(suggestion.operation)} suggestion`,
			},
		});
		const statusIcon = status.createSpan({ cls: "editorialist-suggestion__label-icon" });
		setIcon(statusIcon, this.getOperationIcon(suggestion));
		status.createSpan({
			cls: "editorialist-suggestion__label-text",
			text: this.toSentenceCase(visualState),
		});
		metaPrimary.createDiv({
			cls: "editorialist-suggestion__position",
			text: `${index + 1} of ${total}`,
		});

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

		card.createDiv({ cls: "editorialist-suggestion__identity-spacer" });
		card.createDiv({
			cls: "editorialist-suggestion__contributor",
			text: formatContributorIdentityLabel(suggestion.contributor),
		});

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

	private renderSuggestionCopy(parent: HTMLElement, suggestion: ReviewSuggestion): void {
		const copy = parent.createDiv({ cls: "editorialist-suggestion__copy" });
		getSuggestionCopyBlocks(suggestion).forEach((block) => {
			this.renderCopyBlock(copy, block.label, block.body);
		});
		if (suggestion.why) {
			this.renderCopyBlock(copy, "WHY", suggestion.why);
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
			if (event.button !== 0) {
				return;
			}

			handledPointerDown = true;
			event.preventDefault();
			event.stopPropagation();
			onClick();
		});

		element.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (handledPointerDown) {
				handledPointerDown = false;
				return;
			}

			onClick();
		});
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
			default:
				return "circle";
		}
	}

	private getSourceLabel(suggestion: ReviewSuggestion): string {
		return `Source: ${formatContributorIdentityLabel(suggestion.contributor)}`;
	}
}
