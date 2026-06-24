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
	// Optional itemized list rendered between the description and the action
	// buttons — e.g. the scenes a destructive action will touch. The container
	// is height-capped and scrolls so a large list never pushes the buttons off
	// screen.
	details?: readonly string[];
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

		const details = this.options.details;
		if (details && details.length > 0) {
			const list = this.contentEl.createEl("ul", {
				cls: "editorialist-choice-modal__details",
			});
			for (const item of details) {
				list.createEl("li", {
					cls: "editorialist-choice-modal__details-item",
					text: item,
				});
			}
		}

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
