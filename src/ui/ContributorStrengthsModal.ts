import { TextComponent, setIcon, type App } from "obsidian";
import { PromiseModal } from "./modals/PromiseModal";
import { buildModalFooter, type ModalFooter } from "./primitives/ModalFooter";
import { formatReviewerTypeLabel } from "../core/ContributorIdentity";
import {
	CONTRIBUTOR_ROLE_DEFINITIONS,
	CONTRIBUTOR_STRENGTH_DEFINITIONS,
	type ContributorRoleDefinition,
	type ContributorStrengthDefinition,
} from "../core/ContributorStrengths";
import type { ContributorStrength, ContributorProfile, ReviewerType } from "../models/ContributorProfile";

interface ContributorStrengthsModalOptions {
	profile: ContributorProfile;
}

export interface ContributorStrengthsModalResult {
	displayName: string;
	strengths: ContributorStrength[];
	reviewerType: ReviewerType;
}

class ContributorStrengthsModal extends PromiseModal<ContributorStrengthsModalResult> {
	private displayName: string;
	private identityNameEl: HTMLElement | null = null;
	private identityRoleEl: HTMLSpanElement | null = null;
	private identitySeparatorEl: HTMLSpanElement | null = null;
	private identityUseIconsEl: HTMLElement | null = null;
	private nameInput: TextComponent | null = null;
	private nameEditorEl: HTMLElement | null = null;
	private nameTriggerEl: HTMLElement | null = null;
	private selectedStrengths = new Set<ContributorStrength>();
	private selectedRole: ReviewerType | null;
	private footer: ModalFooter | null = null;

	constructor(
		app: App,
		private readonly options: ContributorStrengthsModalOptions,
	) {
		super(app);
		this.displayName = options.profile.displayName;
		this.selectedRole = options.profile.reviewerType;
	}

	protected renderContent(): void {
		this.contentEl.addClass("editorialist-contributor-modal");

		this.contentEl.createEl("h3", { text: "Edit contributor" });

		const identity = this.contentEl.createDiv({
			cls: "editorialist-contributor-modal__identity",
		});
		this.identityNameEl = identity.createEl("button", {
			cls: "editorialist-contributor-modal__identity-name-link",
			attr: {
				type: "button",
				title: "Rename contributor",
			},
		});
		this.identitySeparatorEl = identity.createSpan({
			cls: "editorialist-contributor-modal__identity-separator",
			text: " \u00b7 ",
		});
		this.identityRoleEl = identity.createSpan({
			cls: "editorialist-contributor-modal__identity-role",
		});
		this.identityUseIconsEl = identity.createDiv({
			cls: "editorialist-contributor-modal__identity-icons",
		});

		const nameSection = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__row" });
		this.nameTriggerEl = nameSection.createEl("button", {
			cls: "editorialist-contributor-modal__rename-link",
			attr: {
				type: "button",
				title: "Rename contributor",
			},
		});
		this.nameTriggerEl.createSpan({
			cls: "editorialist-contributor-modal__rename-link-text",
			text: this.displayName,
		});
		this.nameEditorEl = nameSection.createDiv({
			cls: "editorialist-contributor-modal__rename-editor is-collapsed",
		});
		this.nameInput = new TextComponent(this.nameEditorEl);
		this.nameInput.inputEl.addClass("editorialist-contributor-modal__input");
		this.nameInput.inputEl.addClass("editorialist-contributor-modal__input--rename");
		this.nameInput.setPlaceholder("Enter contributor name");
		this.nameInput.setValue(this.displayName);
		this.nameInput.onChange((value) => {
			this.displayName = value;
			this.syncIdentityPreview();
			this.footer?.syncDisabled();
		});
		this.identityNameEl.addEventListener("click", () => this.openRenameEditor());
		this.nameTriggerEl.addEventListener("click", () => this.openRenameEditor());
		this.nameInput.inputEl.addEventListener("blur", () => this.closeRenameEditor());
		this.nameInput.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.closeRenameEditor();
			}
			if (event.key === "Escape") {
				event.preventDefault();
				this.closeRenameEditor();
			}
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

		this.footer = buildModalFooter(this.contentEl, {
			className: "editorialist-contributor-modal__actions",
			buttons: [
				{
					text: "Save",
					cta: true,
					enableWhen: () => this.displayName.trim().length > 0 && Boolean(this.selectedRole),
					onClick: () => {
						if (!this.selectedRole) {
							return;
						}
						this.finish({
							displayName: this.displayName.trim(),
							strengths: [...this.selectedStrengths],
							reviewerType: this.selectedRole,
						});
					},
				},
				{
					text: "Cancel",
					onClick: () => this.finish(null),
				},
			],
		});
		this.syncIdentityPreview();
		this.footer.syncDisabled();
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
			this.selectedRole = this.selectedRole === definition.value ? null : definition.value;
			this.syncIdentityPreview();
			for (const sync of allSyncCallbacks) {
				sync();
			}
			this.footer?.syncDisabled();
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
			this.syncIdentityPreview();
			syncState();
		});
	}

	private syncIdentityPreview(): void {
		const fallbackName = this.options.profile.displayName;
		const displayName = this.displayName.trim() || fallbackName;
		this.identityNameEl?.setText(displayName);
		this.nameTriggerEl?.setText(displayName);

		const hasRole = Boolean(this.selectedRole);
		if (this.identitySeparatorEl) {
			this.identitySeparatorEl.toggleClass("is-hidden", !hasRole);
		}
		this.identityRoleEl?.setText(hasRole && this.selectedRole ? formatReviewerTypeLabel(this.selectedRole) : "");
		if (this.identityUseIconsEl) {
			this.identityUseIconsEl.empty();
			const selectedDefinitions: Array<{ icon: string; label: string }> = [];
			const roleDefinition = CONTRIBUTOR_ROLE_DEFINITIONS.find((definition) => definition.value === this.selectedRole);
			if (roleDefinition) {
				selectedDefinitions.push({ icon: roleDefinition.icon, label: roleDefinition.label });
			}
			for (const strength of this.selectedStrengths) {
				const definition = CONTRIBUTOR_STRENGTH_DEFINITIONS.find((item) => item.value === strength);
				if (!definition) {
					continue;
				}
				selectedDefinitions.push({ icon: definition.icon, label: definition.label });
			}
			for (const definition of selectedDefinitions) {
				const iconEl = this.identityUseIconsEl.createSpan({
					cls: "editorialist-contributor-modal__identity-icon",
					attr: {
						"aria-label": definition.label,
						title: definition.label,
					},
				});
				setIcon(iconEl, definition.icon);
			}
		}
	}

	private openRenameEditor(): void {
		this.nameTriggerEl?.addClass("is-collapsed");
		this.nameEditorEl?.removeClass("is-collapsed");
		window.setTimeout(() => {
			this.nameInput?.inputEl.focus();
			this.nameInput?.inputEl.select();
		}, 0);
	}

	private closeRenameEditor(): void {
		this.nameEditorEl?.addClass("is-collapsed");
		this.nameTriggerEl?.removeClass("is-collapsed");
	}
}

export function openContributorStrengthsModal(
	app: App,
	options: ContributorStrengthsModalOptions,
): Promise<ContributorStrengthsModalResult | null> {
	return new ContributorStrengthsModal(app, options).present();
}
