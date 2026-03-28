import { ButtonComponent } from "obsidian";
import { WidgetType } from "@codemirror/view";
import type EditorialistPlugin from "../main";

export interface ToolbarState {
	canAccept: boolean;
	canReject: boolean;
	hasReviewBlock: boolean;
	pendingCount: number;
	unresolvedCount: number;
}

export class ReviewToolbarWidget extends WidgetType {
	constructor(
		private readonly plugin: EditorialistPlugin,
		private readonly state: ToolbarState,
	) {
		super();
	}

	eq(other: ReviewToolbarWidget): boolean {
		return JSON.stringify(this.state) === JSON.stringify(other.state);
	}

	toDOM(): HTMLElement {
		const container = document.createElement("div");
		container.className = "editorialist-toolbar";

		const meta = container.createDiv({ cls: "editorialist-toolbar__meta" });
		meta.setText(
			this.state.hasReviewBlock
				? `${this.state.pendingCount} pending • ${this.state.unresolvedCount} unresolved`
				: "No review block in this note",
		);

		const actions = container.createDiv({ cls: "editorialist-toolbar__actions" });
		this.buildButton(actions, "Parse review blocks", () => {
			void this.plugin.parseCurrentNote();
		});
		this.buildButton(actions, "Open review panel", () => {
			void this.plugin.openReviewPanel();
		});
		this.buildButton(
			actions,
			"Accept",
			() => {
				void this.plugin.acceptSelectedSuggestion();
			},
			!this.state.canAccept,
		);
		this.buildButton(
			actions,
			"Reject",
			() => {
				void this.plugin.rejectSelectedSuggestion();
			},
			!this.state.canReject,
		);

		return container;
	}

	ignoreEvent(): boolean {
		return false;
	}

	private buildButton(parent: HTMLElement, label: string, onClick: () => void, disabled = false): void {
		const button = new ButtonComponent(parent).setButtonText(label);
		button.setDisabled(disabled);
		button.buttonEl.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick();
		});
	}
}
