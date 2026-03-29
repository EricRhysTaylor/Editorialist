import { ButtonComponent, Modal, setIcon, type App } from "obsidian";
import { REVIEW_BLOCK_FENCE } from "../core/ReviewBlockFormat";

export interface PrepareReviewFormatModalOptions {
	hasSelectedText: boolean;
	onCopy: () => Promise<void>;
}

export const REVIEW_TEMPLATE_BLOCK = [
	"```" + REVIEW_BLOCK_FENCE,
	"Reviewer: GPT-5.3",
	"ReviewerType: ai-editor",
	"Provider: OpenAI",
	"Model: GPT-5.3",
	"",
	"=== EDIT ===",
	"SceneId: scn_xxxxxxxx",
	"Original: ...",
	"Revised: ...",
	"Why: ...",
	"",
	"=== CUT ===",
	"SceneId: scn_xxxxxxxx",
	"Target: ...",
	"Why: ...",
	"",
	"=== CONDENSE ===",
	"SceneId: scn_xxxxxxxx",
	"Target: ...",
	"Suggestion: ...",
	"Why: ...",
	"",
	"=== MOVE ===",
	"SceneId: scn_xxxxxxxx",
	"Target: ...",
	"Before: ...",
	"Why: ...",
	"```",
].join("\n");

export class PrepareReviewFormatModal extends Modal {
	constructor(app: App, private readonly options: PrepareReviewFormatModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("editorialist-review-format-modal");
		this.contentEl.empty();

		const shell = this.contentEl.createDiv({ cls: "editorialist-review-format-modal__content" });

		const header = shell.createDiv({ cls: "editorialist-review-format-modal__header" });
		const headerIcon = header.createSpan({ cls: "editorialist-review-format-modal__icon" });
		setIcon(headerIcon, "file-text");

		const headerText = header.createDiv({ cls: "editorialist-review-format-modal__header-text" });
		headerText.createDiv({
			cls: "editorialist-review-format-modal__title",
			text: "Prepare review format",
		});
		headerText.createDiv({
			cls: "editorialist-review-format-modal__description",
			text: "Use this template with your AI to generate structured editorial suggestions.",
		});

		const actions = shell.createDiv({ cls: "editorialist-review-format-modal__actions" });
		const copyButton = new ButtonComponent(actions)
			.setButtonText("Copy review template")
			.setCta()
			.onClick(() => {
				void this.options.onCopy();
			});
		copyButton.buttonEl.addClass("editorialist-review-format-modal__button");
		const buttonIcon = copyButton.buttonEl.createSpan({ cls: "editorialist-review-format-modal__button-icon" });
		setIcon(buttonIcon, "copy");

		shell.createDiv({
			cls: "editorialist-review-format-modal__microcopy",
			text: this.options.hasSelectedText
				? "Paste into your AI and return an Editorialist review block with canonical contributor identity. The current selection will be added as a passage."
				: "Paste into your AI and return an Editorialist review block with canonical contributor identity.",
		});

		const example = shell.createDiv({ cls: "editorialist-review-format-modal__example" });
		example.createDiv({
			cls: "editorialist-review-format-modal__example-label",
			text: "Example format",
		});
		example.createEl("pre", {
			cls: "editorialist-review-format-modal__example-block",
			text: REVIEW_TEMPLATE_BLOCK,
		});

		shell.createDiv({
			cls: "editorialist-review-format-modal__footer",
			text: "Return only this fenced block. No extra text.",
		});
	}

	onClose(): void {
		this.contentEl.empty();
		this.modalEl.removeClass("editorialist-review-format-modal");
	}
}

export function buildReviewTemplate(selectedText?: string): string {
	const parts = ["Return only this fenced block. No extra text.", "", REVIEW_TEMPLATE_BLOCK];

	if (selectedText?.trim()) {
		parts.push("", "Passage:", selectedText);
	}

	return parts.join("\n");
}
