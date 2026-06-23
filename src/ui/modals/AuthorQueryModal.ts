import { Setting, type App } from "obsidian";
import { PromiseModal } from "./PromiseModal";

// Collects an author query — the question an author wants Editorialist to
// address on the next review. Resolves the trimmed question text, or null on
// cancel. The caller turns it into a `%%ai: …%%` marker and places it; this
// modal only gathers the text.
export class AuthorQueryModal extends PromiseModal<string> {
	private value = "";

	constructor(app: App) {
		super(app);
	}

	protected renderContent(): void {
		this.titleEl.setText("Insert author query");

		this.contentEl.createEl("p", {
			cls: "editorialist-author-query__hint",
			text: "Adds a hidden %%ai:…%% note in the scene. Editorialist answers it on the next review; readers never see it.",
		});

		new Setting(this.contentEl).setName("Question").addTextArea((textArea) => {
			textArea
				.setPlaceholder("e.g. Is this beat too abrupt after the reveal?")
				.setValue(this.value)
				.onChange((value) => {
					this.value = value;
				});
			textArea.inputEl.rows = 3;
			textArea.inputEl.addClass("editorialist-author-query__input");
			textArea.inputEl.addEventListener("keydown", (evt) => {
				// Submit on Cmd/Ctrl+Enter so newlines inside the question still work.
				if ((evt.metaKey || evt.ctrlKey) && evt.key === "Enter") {
					evt.preventDefault();
					this.submit();
				}
			});
		});

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(null)))
			.addButton((button) =>
				button
					.setButtonText("Insert")
					.setCta()
					.onClick(() => this.submit()),
			);

		this.contentEl.querySelector<HTMLTextAreaElement>(".editorialist-author-query__input")?.focus();
	}

	private submit(): void {
		const trimmed = this.value.trim();
		if (!trimmed) {
			return;
		}
		this.finish(trimmed);
	}
}
