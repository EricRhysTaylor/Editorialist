import { ButtonComponent, Notice, PluginSettingTab, Setting, setIcon, type App } from "obsidian";
import type EditorialistPlugin from "../main";

export class EditorialistSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: EditorialistPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("editorialist-settings");

		containerEl.createEl("h2", { text: "Editorialist admin" });
		containerEl.createDiv({
			cls: "editorialist-settings__description",
			text: "Review activity, contributor profiles, and lightweight maintenance.",
		});

		this.renderActivitySection(containerEl);
		this.renderContributorsSection(containerEl);
		this.renderMaintenanceSection(containerEl);
	}

	private renderActivitySection(parent: HTMLElement): void {
		parent.createEl("h3", { text: "Review activity" });
		const summary = this.plugin.getReviewActivitySummary();
		const cards = parent.createDiv({ cls: "editorialist-settings__stats" });

		this.createStatCard(cards, "Sweeps", `${summary.totalSweeps}`, `${summary.inProgressSweeps} in progress`);
		this.createStatCard(cards, "Completed", `${summary.completedSweeps}`, `${summary.cleanedUpSweeps} cleaned up`);
		this.createStatCard(cards, "Suggestions", `${summary.totalSuggestions}`, `${summary.accepted} accepted`);
		this.createStatCard(cards, "Queue", `${summary.unresolved}`, `${summary.rejected} rejected`);
	}

	private renderContributorsSection(parent: HTMLElement): void {
		parent.createEl("h3", { text: "Contributors" });
		const description = parent.createDiv({ cls: "editorialist-settings__description" });
		description.setText("Humans and AI reviewers share one contributor directory.");

		const list = parent.createDiv({ cls: "editorialist-settings__contributors" });
		const profiles = this.plugin.getSortedReviewerProfiles();
		if (profiles.length === 0) {
			list.createDiv({
				cls: "editorialist-settings__empty",
				text: "No contributor profiles yet.",
			});
			return;
		}

		for (const profile of profiles) {
			const card = list.createDiv({ cls: "editorialist-settings__contributor" });
			const header = card.createDiv({ cls: "editorialist-settings__contributor-header" });
			header.createDiv({
				cls: "editorialist-settings__contributor-title",
				text: profile.displayName,
			});

			const starButton = new ButtonComponent(header)
				.setTooltip(profile.isStarred ? "Unstar contributor" : "Star contributor")
				.onClick(() => {
					void this.plugin.toggleReviewerStarById(profile.id).then(() => this.display());
				});
			starButton.buttonEl.addClass("editorialist-settings__star-button");
			if (profile.isStarred) {
				starButton.buttonEl.addClass("is-starred");
			}
			setIcon(starButton.buttonEl, "star");

			card.createDiv({
				cls: "editorialist-settings__contributor-meta",
				text: this.formatContributorMeta(profile),
			});
			card.createDiv({
				cls: "editorialist-settings__contributor-stats",
				text: this.formatContributorStats(profile),
			});
			card.createDiv({
				cls: "editorialist-settings__contributor-aliases",
				text: `${profile.aliases.length} aliases`,
			});
		}
	}

	private renderMaintenanceSection(parent: HTMLElement): void {
		parent.createEl("h3", { text: "Maintenance" });

		new Setting(parent)
			.setName("Clear cleaned-up batch records")
			.setDesc("Remove registry entries for batches that were already cleaned up.")
			.addButton((button) => {
				button.setButtonText("Clear records");
				button.onClick(async () => {
					const removedCount = await this.plugin.clearCleanedUpSweepRecords();
					this.display();
					if (removedCount === 0) {
						new Notice("No cleaned-up batch records to clear.");
						return;
					}
					new Notice(`Cleared ${removedCount} cleaned-up batch record${removedCount === 1 ? "" : "s"}.`);
				});
			});

		parent.createDiv({
			cls: "editorialist-settings__description",
			text: "Reviewer alias management and batch cleanup tools can expand here later.",
		});
	}

	private createStatCard(parent: HTMLElement, label: string, value: string, detail: string): void {
		const card = parent.createDiv({ cls: "editorialist-settings__stat-card" });
		card.createDiv({ cls: "editorialist-settings__stat-label", text: label });
		card.createDiv({ cls: "editorialist-settings__stat-value", text: value });
		card.createDiv({ cls: "editorialist-settings__stat-detail", text: detail });
	}

	private formatContributorMeta(profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number]): string {
		const parts = [this.toSentenceCase(profile.kind)];
		if (profile.provider) {
			parts.push(profile.provider);
		}
		if (profile.model) {
			parts.push(profile.model);
		}

		return parts.join(" · ");
	}

	private formatContributorStats(profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number]): string {
		const stats = profile.stats;
		if (!stats) {
			return "No activity yet";
		}

		return `${stats.totalSuggestions} suggestions · ${stats.accepted} accepted · ${stats.rejected} rejected · ${stats.unresolved} unresolved`;
	}

	private toSentenceCase(value: string): string {
		if (value === "beta-reader") {
			return "Beta reader";
		}

		if (value === "ai") {
			return "AI";
		}

		return value.charAt(0).toUpperCase() + value.slice(1);
	}
}
