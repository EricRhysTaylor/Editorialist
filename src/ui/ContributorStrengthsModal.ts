import { ButtonComponent, Modal, TextAreaComponent, type App } from "obsidian";
import { formatReviewerTypeLabel } from "../core/ContributorIdentity";
import type { ReviewerProfile } from "../models/ReviewerProfile";

interface ContributorStrengthsModalOptions {
	profile: ReviewerProfile;
}

export interface ContributorStrengthsModalResult {
	strengths: string[];
}

class ContributorStrengthsModal extends Modal {
	private strengthsValue = "";
	private saveButton: ButtonComponent | null = null;

	constructor(
		app: App,
		private readonly options: ContributorStrengthsModalOptions,
		private readonly resolveResult: (result: ContributorStrengthsModalResult | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.addClass("editorialist-contributor-modal");

		this.contentEl.createEl("h3", { text: "Edit contributor strengths" });
		this.contentEl.createDiv({
			cls: "editorialist-contributor-modal__description",
			text: "Add a few focus areas to describe what this contributor is especially useful for. Separate strengths with commas or place one per line.",
		});

		const currentRow = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__row" });
		currentRow.createDiv({
			cls: "editorialist-contributor-modal__label",
			text: "Contributor",
		});
		currentRow.createDiv({
			cls: "editorialist-contributor-modal__value",
			text: this.options.profile.displayName,
		});

		const roleRow = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__row" });
		roleRow.createDiv({
			cls: "editorialist-contributor-modal__label",
			text: "Role",
		});
		roleRow.createDiv({
			cls: "editorialist-contributor-modal__value",
			text: formatReviewerTypeLabel(this.options.profile.reviewerType),
		});

		const strengthsRow = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__create" });
		strengthsRow.createDiv({
			cls: "editorialist-contributor-modal__label",
			text: "Strengths",
		});
		const control = strengthsRow.createDiv({ cls: "editorialist-contributor-modal__control" });
		const input = new TextAreaComponent(control);
		input.inputEl.addClass("editorialist-control-modal__textarea");
		input.inputEl.rows = 4;
		input.setPlaceholder("Clarity, Tone, Pacing");
		input.setValue((this.options.profile.strengths ?? []).join(", "));
		input.onChange((value) => {
			this.strengthsValue = value;
			this.syncSaveState();
		});
		this.strengthsValue = input.getValue();

		const actions = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__actions" });
		const cancel = new ButtonComponent(actions).setButtonText("Cancel");
		cancel.onClick(() => {
			this.resolveResult(null);
			this.close();
		});

		this.saveButton = new ButtonComponent(actions)
			.setButtonText("Save strengths")
			.setCta();
		this.saveButton.onClick(() => {
			this.resolveResult({
				strengths: this.parseStrengths(this.strengthsValue),
			});
			this.close();
		});
		this.syncSaveState();
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolveResult(null);
	}

	private syncSaveState(): void {
		this.saveButton?.setDisabled(false);
	}

	private parseStrengths(value: string): string[] {
		return value
			.split(/[\n,]/)
			.map((item) => item.trim())
			.filter(Boolean);
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
