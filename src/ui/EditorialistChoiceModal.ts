import { type App } from "obsidian";
import { PromiseModal } from "./modals/PromiseModal";
import { buildModalFooter } from "./primitives/ModalFooter";

interface ChoiceOption<T extends string> {
	label: string;
	value: T;
}

interface EditorialistChoiceModalOptions<T extends string> {
	choices: ChoiceOption<T>[];
	description: string;
	title: string;
}

class EditorialistChoiceModal<T extends string> extends PromiseModal<T> {
	constructor(
		app: App,
		private readonly options: EditorialistChoiceModalOptions<T>,
	) {
		super(app);
	}

	protected renderContent(): void {
		this.contentEl.addClass("editorialist-choice-modal");

		this.contentEl.createEl("h3", { text: this.options.title });
		this.contentEl.createDiv({
			cls: "editorialist-choice-modal__description",
			text: this.options.description,
		});

		buildModalFooter(this.contentEl, {
			className: "editorialist-choice-modal__actions",
			buttons: this.options.choices.map((choice) => ({
				text: choice.label,
				className: "editorialist-choice-modal__button",
				onClick: () => this.finish(choice.value),
			})),
		});
	}
}

export function openEditorialistChoiceModal<T extends string>(
	app: App,
	options: EditorialistChoiceModalOptions<T>,
): Promise<T | null> {
	return new EditorialistChoiceModal<T>(app, options).present();
}
