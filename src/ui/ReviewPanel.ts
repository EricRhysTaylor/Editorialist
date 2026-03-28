import { ButtonComponent, DropdownComponent, ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type { ReviewerProfile } from "../models/ReviewerProfile";
import type { ReviewSuggestion } from "../models/ReviewSuggestion";
import type EditorialistPlugin from "../main";

export const REVIEW_PANEL_VIEW_TYPE = "editorialist-review-panel";

export class ReviewPanel extends ItemView {
	private reviewerFilterId: string | null = null;
	private starredOnly = false;
	private reviewerPickerSuggestionId: string | null = null;
	private reviewerPickerValue: string | null = null;

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
				text: "Run “Parse review blocks” on a note that contains an rt-review fenced block.",
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

		filteredSuggestions.forEach((suggestion) => {
			this.renderSuggestionCard(list, suggestion, selectedSuggestionId === suggestion.id);
		});
	}

	private renderFilters(): void {
		const controls = this.contentEl.createDiv({ cls: "editorialist-panel__filters" });
		const filterLabel = controls.createDiv({ cls: "editorialist-panel__filter-label" });
		filterLabel.setText("Reviewer filter");

		const dropdownContainer = controls.createDiv({ cls: "editorialist-panel__filter-control" });
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

		const starredButton = new ButtonComponent(controls)
			.setButtonText(this.starredOnly ? "Show all reviewers" : "Show starred reviewers")
			.onClick(() => {
				this.starredOnly = !this.starredOnly;
				this.render();
			});
		starredButton.buttonEl.addClass("editorialist-panel__filter-button");
	}

	private renderSuggestionCard(parent: HTMLElement, suggestion: ReviewSuggestion, selected: boolean): void {
		const reviewerProfile = this.plugin.getReviewerProfile(suggestion.contributor.reviewerId);
		const reviewerStats = this.plugin.getReviewerStats(suggestion.contributor.reviewerId);

		const card = parent.createDiv({
			cls: `editorialist-suggestion editorialist-review-card editorialist-suggestion--${suggestion.status}${selected ? " is-selected" : ""}`,
		});
		card.addEventListener("click", () => {
			void this.plugin.selectSuggestion(suggestion.id);
		});

		const meta = card.createDiv({ cls: "editorialist-suggestion__meta" });
		meta.createDiv({
			cls: `editorialist-suggestion__label editorialist-suggestion__label--${suggestion.status}`,
			text: this.toSentenceCase(suggestion.status),
		});
		meta.createDiv({
			text: `Block ${suggestion.source.blockIndex + 1} • Entry ${suggestion.source.entryIndex + 1}`,
		});

		card.createDiv({
			cls: "editorialist-suggestion__operation",
			text: this.toSentenceCase(suggestion.operation),
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
			starButton.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				void this.plugin.toggleReviewerStarForSuggestion(suggestion.id);
			});
		}

		if (reviewerStats && reviewerStats.totalSuggestions > 0) {
			card.createDiv({
				cls: "editorialist-suggestion__reviewer-stats",
				text: this.formatStatsLine(reviewerStats),
			});
		}

		card.createDiv({
			cls: "editorialist-suggestion__reviewer-resolution",
			text: `Reviewer resolution: ${this.formatResolutionStatus(suggestion.contributor.resolutionStatus)}`,
		});
		if (this.hasRawReviewerDifference(suggestion, reviewerProfile)) {
			card.createDiv({
				cls: "editorialist-suggestion__reviewer-raw",
				text: `Raw: ${suggestion.contributor.raw.rawName}`,
			});
		}

		if (suggestion.operation === "move") {
			this.renderMoveCopy(card, suggestion);
		} else {
			this.renderReplaceCopy(card, suggestion);
		}

		if (suggestion.why) {
			const why = card.createDiv({ cls: "editorialist-suggestion__why" });
			why.createEl("strong", { text: "Why" });
			why.createDiv({ text: suggestion.why });
		}

		card.createDiv({
			cls: "editorialist-suggestion__reason",
			text: this.getSuggestionReason(suggestion),
		});

		this.renderReviewerResolutionActions(card, suggestion);

		if (this.reviewerPickerSuggestionId === suggestion.id) {
			this.renderReviewerPicker(card, suggestion);
		}

		const actions = card.createDiv({ cls: "editorialist-suggestion__actions" });
		this.renderButton(
			actions,
			"Jump to target",
			() => {
				void this.plugin.jumpToSuggestionTarget(suggestion.id);
			},
			!this.plugin.canJumpToSuggestionTarget(suggestion.id),
		);
		if (suggestion.operation === "move") {
			this.renderButton(
				actions,
				"Jump to anchor",
				() => {
					void this.plugin.jumpToSuggestionAnchor(suggestion.id);
				},
				!this.plugin.canJumpToSuggestionAnchor(suggestion.id),
			);
		}
		this.renderButton(
			actions,
			"Jump to source",
			() => {
				void this.plugin.jumpToSuggestionSource(suggestion.id);
			},
			!this.plugin.canJumpToSuggestionSource(suggestion.id),
		);
		this.renderButton(
			actions,
			"Accept",
			() => {
				void this.plugin.acceptSuggestion(suggestion.id);
			},
			!this.plugin.canAcceptSuggestion(suggestion.id),
		);
		this.renderButton(
			actions,
			"Reject",
			() => {
				void this.plugin.rejectSuggestion(suggestion.id);
			},
			!this.plugin.canRejectSuggestion(suggestion.id),
		);
		this.renderButton(actions, "Skip", () => {
			this.plugin.skipSuggestion(suggestion.id);
		});
	}

	private renderReplaceCopy(parent: HTMLElement, suggestion: ReviewSuggestion): void {
		const copy = parent.createDiv({ cls: "editorialist-suggestion__copy" });
		if (suggestion.original) {
			this.renderCopyBlock(copy, "Original", suggestion.original);
		}
		if (suggestion.revised) {
			this.renderCopyBlock(copy, "Revised", suggestion.revised);
		}
	}

	private renderMoveCopy(parent: HTMLElement, suggestion: ReviewSuggestion): void {
		const copy = parent.createDiv({ cls: "editorialist-suggestion__copy" });
		if (suggestion.target?.text) {
			this.renderCopyBlock(copy, "Target", suggestion.target.text);
		}
		if (suggestion.anchor?.text) {
			this.renderCopyBlock(copy, suggestion.placement === "after" ? "After anchor" : "Before anchor", suggestion.anchor.text);
		}
	}

	private renderReviewerResolutionActions(parent: HTMLElement, suggestion: ReviewSuggestion): void {
		const resolutionStatus = suggestion.contributor.resolutionStatus;
		const needsResolution =
			resolutionStatus === "suggested" ||
			resolutionStatus === "unresolved" ||
			resolutionStatus === "new";

		if (!needsResolution && !this.plugin.canSaveReviewerAlias(suggestion.id)) {
			return;
		}

		const actions = parent.createDiv({ cls: "editorialist-suggestion__reviewer-actions" });
		if (resolutionStatus === "suggested" && suggestion.contributor.suggestedReviewerIds.length > 0) {
			const suggestedProfile = this.plugin.getReviewerProfile(suggestion.contributor.suggestedReviewerIds[0]);
			this.renderButton(actions, suggestedProfile ? `Use ${suggestedProfile.displayName}` : "Use suggested reviewer", () => {
				void this.plugin.useSuggestedReviewer(suggestion.id);
			});
		}

		if (resolutionStatus === "suggested" || resolutionStatus === "unresolved" || resolutionStatus === "new") {
			this.renderButton(actions, "Choose existing reviewer", () => {
				this.reviewerPickerSuggestionId = suggestion.id;
				this.reviewerPickerValue = suggestion.contributor.suggestedReviewerIds[0] ?? this.plugin.getSortedReviewerProfiles()[0]?.id ?? null;
				this.render();
			});
			this.renderButton(actions, "Create new reviewer", () => {
				void this.plugin.createReviewerFromSuggestion(suggestion.id);
			});
			this.renderButton(actions, "Leave unresolved", () => {
				this.plugin.leaveReviewerUnresolved(suggestion.id);
			});
		}

		if (this.plugin.canSaveReviewerAlias(suggestion.id)) {
			this.renderButton(actions, "Save raw name as alias", () => {
				void this.plugin.saveReviewerAliasForSuggestion(suggestion.id);
			});
		}
	}

	private renderReviewerPicker(parent: HTMLElement, suggestion: ReviewSuggestion): void {
		const profiles = this.plugin.getSortedReviewerProfiles();
		if (profiles.length === 0) {
			return;
		}

		const picker = parent.createDiv({ cls: "editorialist-reviewer-picker" });
		picker.createDiv({
			cls: "editorialist-reviewer-picker__label",
			text: "Choose existing reviewer",
		});
		const dropdownContainer = picker.createDiv({ cls: "editorialist-reviewer-picker__control" });
		const dropdown = new DropdownComponent(dropdownContainer);
		profiles.forEach((profile) => {
			dropdown.addOption(profile.id, profile.displayName);
		});
		dropdown.setValue(this.reviewerPickerValue ?? profiles[0]?.id ?? "");
		dropdown.onChange((value) => {
			this.reviewerPickerValue = value;
		});

		const actions = picker.createDiv({ cls: "editorialist-reviewer-picker__actions" });
		this.renderButton(actions, "Use reviewer", () => {
			if (this.reviewerPickerValue) {
				void this.plugin.useSuggestedReviewer(suggestion.id, this.reviewerPickerValue);
			}
			this.reviewerPickerSuggestionId = null;
			this.reviewerPickerValue = null;
			this.render();
		});
		this.renderButton(actions, "Cancel", () => {
			this.reviewerPickerSuggestionId = null;
			this.reviewerPickerValue = null;
			this.render();
		});
	}

	private getSuggestionReason(suggestion: ReviewSuggestion): string {
		if (suggestion.status === "accepted") {
			return "Accepted into the manuscript.";
		}

		if (suggestion.status === "rejected") {
			return "Rejected for this review session.";
		}

		if (suggestion.operation === "move") {
			return suggestion.relocation?.reason ?? suggestion.target?.reason ?? suggestion.anchor?.reason ?? "Awaiting move resolution.";
		}

		return suggestion.manuscriptMatch?.reason ?? "Awaiting replace resolution.";
	}

	private renderCopyBlock(parent: HTMLElement, title: string, body: string): void {
		const wrapper = parent.createDiv();
		wrapper.createEl("strong", { text: title });
		wrapper.createDiv({ text: body });
	}

	private renderButton(parent: HTMLElement, label: string, onClick: () => void, disabled = false): void {
		const button = new ButtonComponent(parent).setButtonText(label);
		button.setDisabled(disabled);
		button.buttonEl.addClass("editorialist-button");
		button.buttonEl.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
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

	private formatResolutionStatus(status: ReviewSuggestion["contributor"]["resolutionStatus"]): string {
		if (status === "exact") {
			return "Exact match";
		}

		if (status === "alias") {
			return "Alias match";
		}

		if (status === "suggested") {
			return "Suggested match";
		}

		if (status === "new") {
			return "New reviewer";
		}

		return "Unresolved";
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

	private formatStatsLine(stats: { accepted: number; rejected: number; totalSuggestions: number }): string {
		return `${stats.totalSuggestions} suggestions · ${stats.accepted} accepted · ${stats.rejected} rejected`;
	}

	private hasRawReviewerDifference(suggestion: ReviewSuggestion, reviewerProfile: ReviewerProfile | null): boolean {
		const rawName = suggestion.contributor.raw.rawName?.trim();
		if (!rawName) {
			return false;
		}

		if (!reviewerProfile) {
			return true;
		}

		return rawName !== reviewerProfile.displayName;
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

	private toSentenceCase(value: string): string {
		return value.charAt(0).toUpperCase() + value.slice(1);
	}
}
