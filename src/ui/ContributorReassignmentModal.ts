import { ButtonComponent, DropdownComponent, Modal, TextComponent, type App } from "obsidian";
import { formatContributorIdentityLabel } from "../core/ContributorIdentity";
import type { ReviewerProfile } from "../models/ReviewerProfile";

export type ContributorReassignmentMode = "merge" | "reassign";

export interface ContributorReassignmentResult {
	createName?: string;
	targetReviewerId?: string;
}

interface ContributorReassignmentModalOptions {
	mode: ContributorReassignmentMode;
	sourceProfile: ReviewerProfile;
	targetProfiles: ReviewerProfile[];
}

class ContributorReassignmentModal extends Modal {
	private createName = "";
	private targetValue = "";

	constructor(
		app: App,
		private readonly options: ContributorReassignmentModalOptions,
		private readonly resolveResult: (result: ContributorReassignmentResult | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.addClass("editorialist-contributor-modal");

		const title = this.options.mode === "merge" ? "Merge contributor" : "Reassign contributor";
		this.contentEl.createEl("h3", { text: title });
		this.contentEl.createDiv({
			cls: "editorialist-contributor-modal__description",
			text:
				this.options.mode === "merge"
					? "Move all revision notes from this contributor into another contributor."
					: "Move all revision notes from this contributor into another contributor or a new contributor.",
		});

		const currentRow = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__row" });
		currentRow.createDiv({
			cls: "editorialist-contributor-modal__label",
			text: "Current contributor",
		});
		currentRow.createDiv({
			cls: "editorialist-contributor-modal__value",
			text: formatContributorIdentityLabel(this.options.sourceProfile),
		});

		const targetRow = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__row" });
		targetRow.createDiv({
			cls: "editorialist-contributor-modal__label",
			text: "Target contributor",
		});
		const targetControl = targetRow.createDiv({ cls: "editorialist-contributor-modal__control" });
		const dropdown = new DropdownComponent(targetControl);
		dropdown.addOption("", "Select contributor");
		for (const profile of this.options.targetProfiles) {
			dropdown.addOption(profile.id, formatContributorIdentityLabel(profile));
		}
		if (this.options.mode === "reassign") {
			dropdown.addOption("__create__", "Create new contributor");
		}
		dropdown.setValue(this.targetValue);
		dropdown.onChange((value) => {
			this.targetValue = value;
			this.renderCreateInput();
			this.syncConfirmState();
		});

		if (this.options.mode === "reassign") {
			const createRow = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__create" });
			createRow.createDiv({
				cls: "editorialist-contributor-modal__label",
				text: "New contributor name",
			});
			const createControl = createRow.createDiv({ cls: "editorialist-contributor-modal__control" });
			const input = new TextComponent(createControl);
			input.inputEl.addClass("editorialist-contributor-modal__input");
			input.setPlaceholder("Enter contributor name");
			input.onChange((value) => {
				this.createName = value;
				this.syncConfirmState();
			});
			this.renderCreateInput = () => {
				createRow.toggleClass("is-hidden", this.targetValue !== "__create__");
				if (this.targetValue !== "__create__") {
					input.setValue("");
					this.createName = "";
				}
			};
			this.renderCreateInput();
		}

		const scopeRow = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__scope" });
		scopeRow.createDiv({
			cls: "editorialist-contributor-modal__label",
			text: "Scope",
		});
		scopeRow.createDiv({
			cls: "editorialist-contributor-modal__value",
			text: "All revision notes",
		});

		const actions = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__actions" });
		const cancel = new ButtonComponent(actions).setButtonText("Cancel");
		cancel.onClick(() => {
			this.resolveResult(null);
			this.close();
		});

		this.confirmButton = new ButtonComponent(actions)
			.setButtonText(this.options.mode === "merge" ? "Merge contributor" : "Reassign contributor")
			.setCta();
		this.confirmButton.onClick(() => {
			if (this.targetValue === "__create__") {
				this.resolveResult({
					createName: this.createName.trim(),
				});
				this.close();
				return;
			}

			this.resolveResult({
				targetReviewerId: this.targetValue,
			});
			this.close();
		});
		this.syncConfirmState();
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolveResult(null);
	}

	private confirmButton: ButtonComponent | null = null;
	private renderCreateInput = (): void => undefined;

	private syncConfirmState(): void {
		const isValid = this.targetValue === "__create__"
			? this.createName.trim().length > 0
			: this.targetValue.trim().length > 0;
		this.confirmButton?.setDisabled(!isValid);
	}
}

export function openContributorReassignmentModal(
	app: App,
	options: ContributorReassignmentModalOptions,
): Promise<ContributorReassignmentResult | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const modal = new ContributorReassignmentModal(app, options, (result) => {
			if (resolved) {
				return;
			}

			resolved = true;
			resolve(result);
		});
		modal.open();
	});
}
