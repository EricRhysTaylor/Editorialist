import { ButtonComponent, DropdownComponent, ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { REVIEW_BLOCK_FENCE } from "../core/ReviewBlockFormat";
import { getSuggestionCopyBlocks, getSuggestionReason as getOperationSuggestionReason, isMoveSuggestion } from "../core/OperationSupport";
import type { ReviewerProfile } from "../models/ReviewerProfile";
import type { ReviewSuggestion } from "../models/ReviewSuggestion";
import type EditorialistPlugin from "../main";

export const REVIEW_PANEL_VIEW_TYPE = "editorialist-review-panel";

export class ReviewPanel extends ItemView {
	private jumpMenuSuggestionId: string | null = null;
	private reviewerFilterId: string | null = null;
	private reviewerMenuSuggestionId: string | null = null;
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
		header.createEl("h2", { text: "Editorial review" });

		if (!session) {
			header.createDiv({
				cls: "editorialist-panel__empty",
				text: `Run “Parse review blocks” on a note that contains an ${REVIEW_BLOCK_FENCE} fenced block.`,
			});
			return;
		}

		header.createDiv({
			cls: "editorialist-panel__empty",
			text: `${session.suggestions.length} suggestions • ${session.notePath}`,
		});

		if (session.suggestions.length === 0) {
			this.contentEl.createDiv({
				cls: "editorialist-panel__empty",
				text: "Review block found, but no valid review entries were parsed.",
			});
			return;
		}

		this.renderFilters();

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
		filteredSuggestions.forEach((suggestion) => {
			const card = this.renderSuggestionCard(list, suggestion, selectedSuggestionId === suggestion.id);
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
		const dropdownContainer = filterControls.createDiv({ cls: "editorialist-panel__filter-control" });
		const dropdown = new DropdownComponent(dropdownContainer);
		dropdown.addOption("", "All reviewers");
		this.plugin.getSortedReviewerProfiles().forEach((profile) => {
			dropdown.addOption(profile.id, profile.displayName);
		});
		dropdown.setValue(this.reviewerFilterId ?? "");
		dropdown.onChange((value) => {
			this.reviewerFilterId = value || null;
			this.render();
		});

		const starredButton = new ButtonComponent(filterControls).onClick(() => {
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

	private renderSuggestionCard(parent: HTMLElement, suggestion: ReviewSuggestion, selected: boolean): HTMLElement {
		const reviewerProfile = this.plugin.getReviewerProfile(suggestion.contributor.reviewerId);
		const visualState = this.plugin.getSuggestionPresentationState(suggestion);

		const card = parent.createDiv({
			cls: `editorialist-suggestion editorialist-review-card editorialist-suggestion--${visualState}${selected ? " is-selected" : ""}`,
		});
		this.bindImmediateAction(card, () => {
			void this.plugin.selectSuggestion(suggestion.id);
		});

		const meta = card.createDiv({ cls: "editorialist-suggestion__meta" });
		meta.createDiv({
			cls: `editorialist-suggestion__label editorialist-suggestion__label--${visualState}`,
			text: `${suggestion.operation.toUpperCase()} • ${this.toSentenceCase(visualState)}`,
		});
		meta.createDiv({
			text: `Block ${suggestion.source.blockIndex + 1} • Entry ${suggestion.source.entryIndex + 1}`,
		});

		const reviewerHeader = card.createDiv({ cls: "editorialist-reviewer-header" });
		reviewerHeader.createDiv({
			cls: "editorialist-suggestion__contributor",
			text: this.formatContributorLine(suggestion, Boolean(reviewerProfile?.isStarred)),
		});
		if (this.plugin.canToggleReviewerStar(suggestion.id)) {
			const starButton = reviewerHeader.createEl("button", {
				cls: `editorialist-reviewer-header__star${reviewerProfile?.isStarred ? " is-starred" : ""}`,
				attr: {
					"aria-label": "Star reviewer",
					title: "Star reviewer",
					type: "button",
				},
			});
			setIcon(starButton, "star");
			this.bindImmediateAction(starButton, () => {
				void this.plugin.toggleReviewerStarForSuggestion(suggestion.id);
			});
		}

		if (this.hasRawReviewerDifference(suggestion, reviewerProfile)) {
			card.createDiv({
				cls: "editorialist-suggestion__reviewer-raw",
				text: `Raw: ${suggestion.contributor.raw.rawName}`,
			});
		}

		this.renderSuggestionCopy(card, suggestion);

		if (suggestion.why) {
			const why = card.createDiv({ cls: "editorialist-suggestion__why" });
			why.createEl("strong", { text: "Why" });
			why.createDiv({ text: suggestion.why });
		}

		card.createDiv({
			cls: "editorialist-suggestion__reason",
			text: this.getSuggestionReason(suggestion),
		});

		const actions = card.createDiv({ cls: "editorialist-suggestion__actions" });
		this.renderButton(
			actions,
			this.reviewerMenuSuggestionId === suggestion.id
				? `Reviewer: ${suggestion.contributor.displayName} ▴`
				: `Reviewer: ${suggestion.contributor.displayName} ▾`,
			() => {
				this.toggleReviewerMenu(suggestion);
			},
			{ disabled: !this.needsReviewerMenu(suggestion) },
		);
		this.renderButton(
			actions,
			this.jumpMenuSuggestionId === suggestion.id ? "Jump ▴" : "Jump ▾",
			() => {
				this.toggleJumpMenu(suggestion.id);
			},
			{ disabled: !this.hasAnyJumpTarget(suggestion.id), icon: "navigation" },
		);

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
	}

	private renderReviewerMenu(parent: HTMLElement, suggestion: ReviewSuggestion): void {
		const picker = parent.createDiv({ cls: "editorialist-reviewer-picker" });
		picker.createDiv({
			cls: "editorialist-reviewer-picker__label",
			text: this.getReviewerMenuLabel(suggestion),
		});

		const profiles = this.plugin.getSortedReviewerProfiles();
		if (profiles.length > 0) {
			const dropdownContainer = picker.createDiv({ cls: "editorialist-reviewer-picker__control" });
			const dropdown = new DropdownComponent(dropdownContainer);
			profiles.forEach((profile) => {
				dropdown.addOption(profile.id, profile.displayName);
			});
			dropdown.setValue(this.reviewerPickerValue ?? profiles[0]?.id ?? "");
			dropdown.onChange((value) => {
				this.reviewerPickerValue = value;
			});
		}

		const actions = picker.createDiv({ cls: "editorialist-reviewer-picker__actions" });
		if (profiles.length > 0) {
			this.renderButton(actions, "Assign selected", () => {
				if (this.reviewerPickerValue) {
					void this.plugin.useSuggestedReviewer(suggestion.id, this.reviewerPickerValue);
				}
				this.closeReviewerMenu();
			});
		}
		this.renderButton(actions, "Create new", () => {
			void this.plugin.createReviewerFromSuggestion(suggestion.id);
			this.closeReviewerMenu();
		});
		this.renderButton(actions, "Leave unresolved", () => {
			this.plugin.leaveReviewerUnresolved(suggestion.id);
			this.closeReviewerMenu();
		});
		if (this.plugin.canSaveReviewerAlias(suggestion.id)) {
			this.renderButton(actions, "Save raw name as alias", () => {
				void this.plugin.saveReviewerAliasForSuggestion(suggestion.id);
				this.closeReviewerMenu();
			});
		}
		this.renderButton(actions, "Close", () => {
			this.closeReviewerMenu();
		});
	}

	private renderJumpMenu(parent: HTMLElement, suggestion: ReviewSuggestion): void {
		const menu = parent.createDiv({ cls: "editorialist-reviewer-picker" });
		menu.createDiv({
			cls: "editorialist-reviewer-picker__label",
			text: "Jump to",
		});

		const actions = menu.createDiv({ cls: "editorialist-reviewer-picker__actions" });
		this.renderButton(
			actions,
			"Target",
			() => {
				void this.plugin.jumpToSuggestionTarget(suggestion.id);
				this.closeJumpMenu();
			},
			{ disabled: !this.plugin.canJumpToSuggestionTarget(suggestion.id), icon: "crosshair" },
		);
		this.renderButton(
			actions,
			"Source",
			() => {
				void this.plugin.jumpToSuggestionSource(suggestion.id);
				this.closeJumpMenu();
			},
			{ disabled: !this.plugin.canJumpToSuggestionSource(suggestion.id), icon: "file-text" },
		);
		if (isMoveSuggestion(suggestion)) {
			this.renderButton(
				actions,
				"Anchor",
				() => {
					void this.plugin.jumpToSuggestionAnchor(suggestion.id);
					this.closeJumpMenu();
				},
				{ disabled: !this.plugin.canJumpToSuggestionAnchor(suggestion.id), icon: "link" },
			);
		}
		this.renderButton(actions, "Close", () => {
			this.closeJumpMenu();
		}, { icon: "x" });
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
		this.jumpMenuSuggestionId = null;
		this.render();
	}

	private closeReviewerMenu(): void {
		this.reviewerMenuSuggestionId = null;
		this.reviewerPickerValue = null;
		this.render();
	}

	private toggleJumpMenu(suggestionId: string): void {
		this.jumpMenuSuggestionId = this.jumpMenuSuggestionId === suggestionId ? null : suggestionId;
		if (this.jumpMenuSuggestionId) {
			this.reviewerMenuSuggestionId = null;
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

	private getReviewerMenuLabel(suggestion: ReviewSuggestion): string {
		if (suggestion.contributor.resolutionStatus === "suggested") {
			const suggestedProfile = this.plugin.getReviewerProfile(suggestion.contributor.suggestedReviewerIds[0]);
			return suggestedProfile
				? `Reviewer: ${suggestedProfile.displayName}`
				: `Reviewer: ${suggestion.contributor.displayName}`;
		}

		return `Reviewer: ${suggestion.contributor.displayName}`;
	}

	private getSuggestionReason(suggestion: ReviewSuggestion): string {
		return getOperationSuggestionReason(suggestion);
	}

	private renderCopyBlock(parent: HTMLElement, title: string, body: string): void {
		const wrapper = parent.createDiv({
			cls: `editorialist-suggestion__copy-block editorialist-suggestion__copy-block--${title.toLowerCase()}`,
		});
		wrapper.createEl("strong", { text: title });
		wrapper.createDiv({ cls: "editorialist-suggestion__copy-body", text: body });
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

	private renderButton(
		parent: HTMLElement,
		label: string,
		onClick: () => void,
		options?: {
			disabled?: boolean;
			icon?: string;
		},
	): void {
		const button = new ButtonComponent(parent).setButtonText(label);
		button.setDisabled(Boolean(options?.disabled));
		button.buttonEl.addClass("editorialist-button");
		if (options?.icon) {
			const icon = button.buttonEl.createSpan({ cls: "editorialist-button__icon" });
			button.buttonEl.prepend(icon);
			setIcon(icon, options.icon);
		}
		this.bindImmediateAction(button.buttonEl, onClick);
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

	private formatContributorKind(kind: ReviewSuggestion["contributor"]["kind"]): string {
		if (kind === "beta-reader") {
			return "Beta reader";
		}

		if (kind === "ai") {
			return "AI";
		}

		return kind.charAt(0).toUpperCase() + kind.slice(1);
	}

	private formatContributorLine(suggestion: ReviewSuggestion, isStarred: boolean): string {
		const parts = [
			suggestion.contributor.displayName,
			this.formatContributorKind(suggestion.contributor.kind),
		];

		if (suggestion.contributor.kind === "ai" && (suggestion.contributor.provider || suggestion.contributor.model)) {
			const providerDetail = [suggestion.contributor.provider, suggestion.contributor.model].filter(Boolean).join(" • ");
			parts.push(`(${providerDetail})`);
		}

		if (isStarred) {
			parts.push("★");
		}

		return parts.join(" · ");
	}

	private hasRawReviewerDifference(suggestion: ReviewSuggestion, reviewerProfile: ReviewerProfile | null): boolean {
		const rawName = suggestion.contributor.raw.rawName?.trim();
		if (!rawName) {
			return false;
		}

		const canonicalName = reviewerProfile?.displayName ?? suggestion.contributor.displayName;
		return rawName !== canonicalName;
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
}
