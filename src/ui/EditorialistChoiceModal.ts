import { ButtonComponent, Modal, type App } from "obsidian";

interface ChoiceOption<T extends string> {
	label: string;
	value: T;
}

interface EditorialistChoiceModalOptions<T extends string> {
	choices: ChoiceOption<T>[];
	description: string;
	title: string;
}

class EditorialistChoiceModal<T extends string> extends Modal {
	constructor(
		app: App,
		private readonly options: EditorialistChoiceModalOptions<T>,
		private readonly resolveChoice: (value: T | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.addClass("editorialist-choice-modal");

		this.contentEl.createEl("h3", { text: this.options.title });
		this.contentEl.createDiv({
			cls: "editorialist-choice-modal__description",
			text: this.options.description,
		});

		const actions = this.contentEl.createDiv({ cls: "editorialist-choice-modal__actions" });
		for (const choice of this.options.choices) {
			const button = new ButtonComponent(actions).setButtonText(choice.label);
			button.buttonEl.addClass("editorialist-choice-modal__button");
			button.onClick(() => {
				this.resolveChoice(choice.value);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolveChoice(null);
	}
}

export function openEditorialistChoiceModal<T extends string>(
	app: App,
	options: EditorialistChoiceModalOptions<T>,
): Promise<T | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const modal = new EditorialistChoiceModal(app, options, (value) => {
			if (resolved) {
				return;
			}

			resolved = true;
			resolve(value);
		});
		modal.open();
	});
}
