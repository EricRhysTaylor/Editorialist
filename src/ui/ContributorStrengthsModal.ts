import { ButtonComponent, Modal, setIcon, type App } from "obsidian";
import { formatReviewerTypeLabel } from "../core/ContributorIdentity";
import {
	CONTRIBUTOR_ROLE_DEFINITIONS,
	CONTRIBUTOR_STRENGTH_DEFINITIONS,
	type ContributorRoleDefinition,
	type ContributorStrengthDefinition,
} from "../core/ContributorStrengths";
import type { ContributorStrength, ReviewerProfile, ReviewerType } from "../models/ReviewerProfile";

interface ContributorStrengthsModalOptions {
	profile: ReviewerProfile;
}

export interface ContributorStrengthsModalResult {
	strengths: ContributorStrength[];
	reviewerType: ReviewerType;
}

class ContributorStrengthsModal extends Modal {
	private selectedStrengths = new Set<ContributorStrength>();
	private selectedRole: ReviewerType;
	private saveButton: ButtonComponent | null = null;

	constructor(
		app: App,
		private readonly options: ContributorStrengthsModalOptions,
		private readonly resolveResult: (result: ContributorStrengthsModalResult | null) => void,
	) {
		super(app);
		this.selectedRole = options.profile.reviewerType;
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.addClass("editorialist-contributor-modal");

		this.contentEl.createEl("h3", { text: "Edit contributor" });

		const identity = this.contentEl.createDiv({
			cls: "editorialist-contributor-modal__identity",
		});
		identity.createSpan({
			cls: "editorialist-contributor-modal__identity-name",
			text: this.options.profile.displayName,
		});
		identity.createSpan({
			cls: "editorialist-contributor-modal__identity-separator",
			text: " \u00b7 ",
		});
		identity.createSpan({
			cls: "editorialist-contributor-modal__identity-role",
			text: formatReviewerTypeLabel(this.options.profile.reviewerType),
		});

		const roleSection = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__section" });
		roleSection.createDiv({
			cls: "editorialist-contributor-modal__label",
			text: "How do you use this contributor?",
		});
		this.selectedRole = this.options.profile.reviewerType;
		const roleGrid = roleSection.createDiv({ cls: "editorialist-contributor-modal__tile-grid" });
		const roleSyncCallbacks: Array<() => void> = [];
		for (const definition of CONTRIBUTOR_ROLE_DEFINITIONS) {
			roleSyncCallbacks.push(this.createRoleTile(roleGrid, definition, roleSyncCallbacks));
		}

		const detailSection = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__section" });
		const detailToggle = detailSection.createEl("button", {
			cls: "editorialist-contributor-modal__detail-toggle",
			attr: { type: "button" },
		});
		const detailChevron = detailToggle.createSpan({ cls: "editorialist-contributor-modal__detail-chevron" });
		setIcon(detailChevron, "chevron-right");
		detailToggle.createSpan({ text: "More detail (optional)" });

		this.selectedStrengths = new Set(this.options.profile.strengths ?? []);
		const detailContent = detailSection.createDiv({
			cls: "editorialist-contributor-modal__detail-content is-collapsed",
		});
		const strengthGrid = detailContent.createDiv({ cls: "editorialist-contributor-modal__tile-grid" });
		for (const definition of CONTRIBUTOR_STRENGTH_DEFINITIONS) {
			this.createStrengthTile(strengthGrid, definition);
		}

		let detailOpen = false;
		detailToggle.addEventListener("click", () => {
			detailOpen = !detailOpen;
			detailContent.toggleClass("is-collapsed", !detailOpen);
			detailToggle.toggleClass("is-open", detailOpen);
		});

		const actions = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__actions" });
		const cancel = new ButtonComponent(actions).setButtonText("Cancel");
		cancel.onClick(() => {
			this.resolveResult(null);
			this.close();
		});

		this.saveButton = new ButtonComponent(actions)
			.setButtonText("Save")
			.setCta();
		this.saveButton.onClick(() => {
			this.resolveResult({
				strengths: [...this.selectedStrengths],
				reviewerType: this.selectedRole,
			});
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolveResult(null);
	}

	private createRoleTile(
		parent: HTMLElement,
		definition: ContributorRoleDefinition,
		allSyncCallbacks: Array<() => void>,
	): () => void {
		const tile = parent.createEl("button", {
			cls: "editorialist-contributor-modal__tile",
			attr: { type: "button", title: definition.label, "aria-label": definition.label },
		});
		const icon = tile.createSpan({ cls: "editorialist-contributor-modal__tile-icon" });
		setIcon(icon, definition.icon);
		tile.createSpan({
			cls: "editorialist-contributor-modal__tile-label",
			text: definition.label,
		});

		const syncState = () => {
			tile.toggleClass("is-selected", this.selectedRole === definition.value);
		};
		syncState();

		tile.addEventListener("click", () => {
			this.selectedRole = definition.value;
			for (const sync of allSyncCallbacks) {
				sync();
			}
		});

		return syncState;
	}

	private createStrengthTile(parent: HTMLElement, definition: ContributorStrengthDefinition): void {
		const tile = parent.createEl("button", {
			cls: "editorialist-contributor-modal__tile",
			attr: { type: "button", title: definition.label, "aria-label": definition.label },
		});
		const icon = tile.createSpan({ cls: "editorialist-contributor-modal__tile-icon" });
		setIcon(icon, definition.icon);
		tile.createSpan({
			cls: "editorialist-contributor-modal__tile-label",
			text: definition.label,
		});

		const syncState = () => {
			tile.toggleClass("is-selected", this.selectedStrengths.has(definition.value));
		};
		syncState();

		tile.addEventListener("click", () => {
			if (this.selectedStrengths.has(definition.value)) {
				this.selectedStrengths.delete(definition.value);
			} else {
				this.selectedStrengths.add(definition.value);
			}
			syncState();
		});
	}
}

export function openContributorStrengthsModal(
	app: App,
	options: ContributorStrengthsModalOptions,
): Promise<ContributorStrengthsModalResult | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const modal = new ContributorStrengthsModal(app, options, (result) => {
			if (resolved) {
				return;
			}
			resolved = true;
			resolve(result);
		});
		modal.open();
	});
}
