import { ButtonComponent, Notice, PluginSettingTab, setIcon, type App } from "obsidian";
import {
	formatContributorIdentityLabel,
	formatContributorProviderModel,
} from "../core/ContributorIdentity";
import type { SceneReviewRecord } from "../models/ReviewerProfile";
import type EditorialistPlugin from "../main";

export class EditorialistSettingTab extends PluginSettingTab {
	private static readonly SETTINGS_DOCS_URL = "https://github.com/EricRhysTaylor/Editorialist#readme";
	private activeBookOnly = true;
	private activeTab: "core" | "reviewer" = "core";

	constructor(
		app: App,
		private readonly plugin: EditorialistPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		void this.displayAsync();
	}

	private async displayAsync(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("editorialist-settings");

		await this.plugin.syncOperationalMetadata();
		const summary = this.plugin.getReviewActivitySummary();
		const activeBook = this.plugin.getActiveBookScopeInfo();
		if (!activeBook.label) {
			this.activeBookOnly = false;
		}

		const shell = containerEl.createDiv({ cls: "editorialist-settings__shell" });
		const tabBar = shell.createDiv({ cls: "editorialist-settings__tabs" });
		this.createTab(tabBar, "core", "settings", "Core");
		this.createTab(tabBar, "reviewer", "users", "Reviewers");

		const coreContent = shell.createDiv({ cls: "editorialist-settings__tab-content" });
		const reviewerContent = shell.createDiv({ cls: "editorialist-settings__tab-content" });
		coreContent.toggleClass("is-hidden", this.activeTab !== "core");
		reviewerContent.toggleClass("is-hidden", this.activeTab !== "reviewer");

		const inventory = this.plugin.getSceneReviewRecords({ activeBookOnly: this.activeBookOnly });
		this.renderCoreHero(coreContent);
		this.renderHero(coreContent, summary);
		this.renderActivitySection(coreContent, summary);
		this.renderInventorySection(coreContent, inventory, activeBook.label);
		this.renderMaintenanceSection(coreContent);

		this.renderContributorsSection(reviewerContent);
		this.renderMetadataSection(reviewerContent);
	}

	private renderCoreHero(parent: HTMLElement): void {
		const hero = parent.createDiv({
			cls: "editorialist-settings__hero-intro editorialist-settings__panel",
		});
		const badgeRow = hero.createDiv({ cls: "editorialist-settings__hero-intro-badge-row" });
		const badge = badgeRow.createSpan({ cls: "editorialist-settings__hero-intro-badge" });
		const badgeIcon = badge.createSpan({ cls: "editorialist-settings__hero-intro-badge-icon" });
		setIcon(badgeIcon, "settings");
		badge.createSpan({
			cls: "editorialist-settings__hero-intro-badge-text",
			text: "Core · Editorial review",
		});
		const badgeLink = badge.createEl("a", {
			href: EditorialistSettingTab.SETTINGS_DOCS_URL,
			cls: "editorialist-settings__hero-intro-badge-link",
			attr: {
				"aria-label": "Open Editorialist documentation",
				target: "_blank",
				rel: "noopener",
			},
		});
		setIcon(badgeLink, "external-link");

		const titleRow = hero.createDiv({ cls: "editorialist-settings__hero-intro-title-row" });
		titleRow.createDiv({
			cls: "editorialist-settings__hero-intro-title",
			text: "Keep your edits organized and easy to manage.",
		});
		hero.createDiv({
			cls: "editorialist-settings__hero-intro-subtitle",
			text: "Editorialist tracks your revision notes across scenes, shows what’s been reviewed, and keeps contributor history so you can pick up where you left off. You can also export this data to keep a backup.",
		});

		const features = hero.createDiv({ cls: "editorialist-settings__hero-features" });
		features.createDiv({
			cls: "editorialist-settings__hero-features-kicker",
			text: "Core highlights:",
		});
		const featureList = features.createDiv({ cls: "editorialist-settings__hero-features-list" });
		this.createHeroFeature(featureList, "table-properties", "Scene inventory — see every scene that still has revision notes and track progress at a glance.");
		this.createHeroFeature(featureList, "list-todo", "Review in context — jump straight into any scene and continue editing without searching.");
		this.createHeroFeature(featureList, "database-backup", "Backup your data — export contributor history and revision activity without touching your manuscript.");
	}

	private renderHero(
		parent: HTMLElement,
		summary: ReturnType<EditorialistPlugin["getReviewActivitySummary"]>,
	): void {
		const hero = parent.createDiv({
			cls: "editorialist-settings__hero editorialist-settings__panel",
		});
		const titleRow = this.createSectionTitleRow(hero, "pie-chart", "Editorial progress");
		titleRow.addClass("editorialist-settings__section-title-row--hero");
		hero.createDiv({
			cls: "editorialist-settings__hero-subtitle",
			text: "Keep the active queue, completed sweeps, and long-term review metadata in one calm operational view.",
		});

		const processedCount = Math.max(0, summary.processed);
		const completionRatio = summary.totalSuggestions > 0 ? processedCount / summary.totalSuggestions : 0;
		const heroBody = hero.createDiv({ cls: "editorialist-settings__hero-body" });
		const progressCard = heroBody.createDiv({ cls: "editorialist-settings__hero-progress" });
		const ring = progressCard.createDiv({ cls: "editorialist-settings__hero-ring" });
		ring.style.setProperty("--editorialist-settings-progress", `${Math.round(completionRatio * 360)}deg`);
		ring.createDiv({ cls: "editorialist-settings__hero-ring-value", text: `${processedCount}/${summary.totalSuggestions}` });
		progressCard.createDiv({
			cls: "editorialist-settings__hero-progress-title",
			text: "Revisions processed",
		});
		progressCard.createDiv({
			cls: "editorialist-settings__hero-progress-detail",
			text: summary.totalSuggestions > 0
				? `${summary.unresolved} pending · ${summary.deferred} deferred`
				: "No review activity yet",
		});

		const summaryGrid = heroBody.createDiv({ cls: "editorialist-settings__hero-summary" });
		this.createHeroMetric(summaryGrid, "Sweeps", `${summary.totalSweeps}`, `${summary.inProgressSweeps} in progress`);
		this.createHeroMetric(summaryGrid, "Accepted", `${summary.accepted}`, `${summary.rejected} rejected`);
		this.createHeroMetric(summaryGrid, "Queue", `${summary.unresolved}`, `${summary.deferred} deferred`);
	}

	private renderActivitySection(
		parent: HTMLElement,
		summary: ReturnType<EditorialistPlugin["getReviewActivitySummary"]>,
	): void {
		const body = this.createSection(
			parent,
			"Review activity",
			"Imported sweeps and manuscript decisions across Editorialist.",
			"activity",
		);
		const cards = body.createDiv({ cls: "editorialist-settings__stats" });

		this.createStatCard(cards, "Sweeps", `${summary.totalSweeps}`, `${summary.inProgressSweeps} in progress`);
		this.createStatCard(cards, "Completed", `${summary.completedSweeps}`, `${summary.cleanedUpSweeps} cleaned up`);
		this.createStatCard(cards, "Suggestions", `${summary.totalSuggestions}`, `${summary.accepted} accepted`);
		this.createStatCard(cards, "Queue", `${summary.unresolved}`, `${summary.deferred} deferred`);
	}

	private renderInventorySection(
		parent: HTMLElement,
		inventory: SceneReviewRecord[],
		activeBookLabel: string | null,
	): void {
		const body = this.createSection(
			parent,
			"Scene inventory",
			"Every scene note that currently carries Editorialist revision notes or has been cleaned and retained in the metadata log.",
			"table-properties",
		);

		const toolbar = body.createDiv({ cls: "editorialist-settings__inventory-toolbar" });
		const actions = toolbar.createDiv({ cls: "editorialist-settings__inventory-actions" });
		this.createActionButton(actions, "brush-cleaning", "Clean all notes", async () => {
			const removed = await this.plugin.cleanupAllSceneReviewNotes(this.activeBookOnly);
			this.display();
			new Notice(
				removed > 0
					? `Cleaned ${removed} imported review block${removed === 1 ? "" : "s"} across scene notes.`
					: "No imported review blocks were found to clean.",
			);
		});
		this.createActionButton(actions, "archive-x", "Clean completed notes", async () => {
			const removed = await this.plugin.cleanupCompletedSceneReviewNotes(this.activeBookOnly);
			this.display();
			new Notice(
				removed > 0
					? `Cleaned ${removed} imported review block${removed === 1 ? "" : "s"} from completed scene notes.`
					: "No completed scene notes were ready for cleanup.",
			);
		});

		if (activeBookLabel) {
			const filterButton = this.createActionButton(
				actions,
				"book-open",
				this.activeBookOnly ? `Active book: ${activeBookLabel}` : "All books",
				async () => {
					this.activeBookOnly = !this.activeBookOnly;
					this.display();
				},
			);
			filterButton.addClass("editorialist-settings__inventory-filter");
			if (this.activeBookOnly) {
				filterButton.addClass("is-active");
			}
		}

		if (inventory.length === 0) {
			body.createDiv({
				cls: "editorialist-settings__empty",
				text: this.activeBookOnly && activeBookLabel
					? `No Editorialist scene records found in ${activeBookLabel}.`
					: "No Editorialist scene records yet.",
			});
			return;
		}

		const tableWrap = body.createDiv({ cls: "editorialist-settings__inventory-wrap" });
		const table = tableWrap.createEl("table", { cls: "editorialist-settings__inventory-table" });
		const head = table.createTHead().insertRow();
		[
			"Scene",
			"Book / path",
			"Batches",
			"Pending",
			"Deferred",
			"Resolved",
			"Status",
			"Last updated",
			"Actions",
		].forEach((label) => head.createEl("th", { text: label }));

		const bodyEl = table.createTBody();
		for (const record of inventory) {
			const row = bodyEl.insertRow();
			row.createEl("td", { text: record.noteTitle });
			row.createEl("td", { text: this.formatInventoryPathHint(record) });
			row.createEl("td", { text: `${record.batchCount}` });
			row.createEl("td", { text: `${record.pendingCount}` });
			row.createEl("td", { text: `${record.deferredCount}` });
			row.createEl("td", { text: `${record.resolvedCount}` });
			const statusCell = row.createEl("td");
			statusCell.createSpan({
				cls: `editorialist-settings__inventory-status editorialist-settings__inventory-status--${record.status}`,
				text: this.formatInventoryStatus(record.status),
			});
			row.createEl("td", { text: this.formatDateTime(record.lastUpdated) });

			const actionsCell = row.createEl("td");
			const actionGroup = actionsCell.createDiv({ cls: "editorialist-settings__inventory-row-actions" });
			this.createActionButton(actionGroup, "file-text", "Open scene", async () => {
				await this.plugin.openSceneNote(record.notePath);
			});
			this.createActionButton(actionGroup, "play", record.status === "not_started" ? "Start review" : "Resume review", async () => {
				await this.plugin.startOrResumeReviewForNote(record.notePath);
			});
			this.createActionButton(actionGroup, "brush-cleaning", "Clean this note", async () => {
				await this.plugin.cleanSceneReviewNote(record.notePath);
				this.display();
			});
		}
	}

	private renderContributorsSection(parent: HTMLElement): void {
		const body = this.createSection(
			parent,
			"Reviewer directory",
			"People and AI systems that have contributed editorial suggestions.",
			"users",
		);

		const list = body.createDiv({ cls: "editorialist-settings__contributors" });
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
			const providerModel = formatContributorProviderModel(profile);
			if (providerModel) {
				card.createDiv({
					cls: "editorialist-settings__contributor-meta",
					text: providerModel,
				});
			}
			card.createDiv({
				cls: "editorialist-settings__contributor-stats",
				text: this.formatContributorStats(profile),
			});
			card.createDiv({
				cls: "editorialist-settings__contributor-aliases",
				text: profile.aliases.length > 0 ? `Aliases: ${profile.aliases.join(" · ")}` : "Aliases: none",
			});
		}
	}

	private renderMetadataSection(parent: HTMLElement): void {
		const body = this.createSection(
			parent,
			"Admin export",
			"Back up contributor, sweep, and scene-review metadata without exporting manuscript text.",
			"database-backup",
		);
		const card = body.createDiv({ cls: "editorialist-settings__maintenance-card" });
		card.createDiv({
			cls: "editorialist-settings__maintenance-title",
			text: "Export Editorialist metadata",
		});
		card.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: "Creates a versioned JSON file with contributor profiles, aliases, stars, sweep history, and scene inventory records.",
		});
		const actions = card.createDiv({ cls: "editorialist-settings__maintenance-actions" });
		this.createActionButton(actions, "download", "Export JSON", async () => {
			const path = await this.plugin.exportEditorialistMetadata();
			new Notice(`Exported Editorialist metadata to ${path}.`);
		});
		card.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text: "The export schema is versioned so a future import and restore workflow can reconnect this metadata safely.",
		});
	}

	private renderMaintenanceSection(parent: HTMLElement): void {
		const body = this.createSection(
			parent,
			"Maintenance",
			"Keep Editorialist records tidy without touching accepted manuscript edits.",
			"wrench",
		);
		const actionCard = body.createDiv({
			cls: "editorialist-settings__maintenance-card",
		});
		actionCard.createDiv({
			cls: "editorialist-settings__maintenance-title",
			text: "Clear cleaned-up batch records",
		});
		actionCard.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: "Remove registry entries for imported batches that were already cleaned up.",
		});

		const actions = actionCard.createDiv({ cls: "editorialist-settings__maintenance-actions" });
		const clearButton = this.createActionButton(actions, "trash-2", "Clear records", async () => {
			const removedCount = await this.plugin.clearCleanedUpSweepRecords();
			this.display();
			if (removedCount === 0) {
				new Notice("No cleaned-up batch records to clear.");
				return;
			}
			new Notice(`Cleared ${removedCount} cleaned-up batch record${removedCount === 1 ? "" : "s"}.`);
		});
		clearButton.addClass("editorialist-settings__maintenance-button");

		actionCard.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text: "Contributor alias management and broader cleanup tools can expand here later.",
		});
	}

	private createTab(parent: HTMLElement, id: "core" | "reviewer", icon: string, label: string): void {
		const tab = parent.createDiv({
			cls: "editorialist-settings__tab" + (this.activeTab === id ? " is-active" : ""),
		});
		const iconEl = tab.createSpan({ cls: "editorialist-settings__tab-icon" });
		setIcon(iconEl, icon);
		tab.createSpan({ cls: "editorialist-settings__tab-label", text: label });
		tab.addEventListener("click", () => {
			if (this.activeTab === id) {
				return;
			}
			this.activeTab = id;
			this.display();
		});
	}

	private createSection(
		parent: HTMLElement,
		title: string,
		description: string,
		icon: string,
	): HTMLElement {
		const section = parent.createDiv({
			cls: "editorialist-settings__section editorialist-settings__panel",
		});
		const header = section.createDiv({ cls: "editorialist-settings__section-header" });
		this.createSectionTitleRow(header, icon, title);
		const heading = header.createDiv({ cls: "editorialist-settings__section-heading" });
		heading.createDiv({ cls: "editorialist-settings__section-description", text: description });

		return section.createDiv({ cls: "editorialist-settings__section-body" });
	}

	private createSectionTitleRow(parent: HTMLElement, icon: string, title: string): HTMLElement {
		const row = parent.createDiv({ cls: "editorialist-settings__section-title-row" });
		const iconEl = row.createSpan({ cls: "editorialist-settings__section-title-icon" });
		setIcon(iconEl, icon);
		row.createSpan({ cls: "editorialist-settings__section-title", text: title });
		const link = row.createEl("a", {
			href: EditorialistSettingTab.SETTINGS_DOCS_URL,
			cls: "editorialist-settings__section-title-link",
			attr: {
				"aria-label": `Open documentation for ${title}`,
				target: "_blank",
				rel: "noopener",
			},
		});
		setIcon(link, "external-link");
		return row;
	}

	private createHeroFeature(parent: HTMLElement, icon: string, text: string): void {
		const item = parent.createDiv({ cls: "editorialist-settings__hero-feature" });
		const iconEl = item.createSpan({ cls: "editorialist-settings__hero-feature-icon" });
		setIcon(iconEl, icon);
		item.createSpan({ cls: "editorialist-settings__hero-feature-text", text });
	}

	private createHeroMetric(parent: HTMLElement, label: string, value: string, detail: string): void {
		const metric = parent.createDiv({ cls: "editorialist-settings__hero-metric" });
		metric.createDiv({ cls: "editorialist-settings__hero-metric-label", text: label });
		metric.createDiv({ cls: "editorialist-settings__hero-metric-value", text: value });
		metric.createDiv({ cls: "editorialist-settings__hero-metric-detail", text: detail });
	}

	private createStatCard(parent: HTMLElement, label: string, value: string, detail: string): void {
		const card = parent.createDiv({ cls: "editorialist-settings__stat-card" });
		card.createDiv({ cls: "editorialist-settings__stat-label", text: label });
		card.createDiv({ cls: "editorialist-settings__stat-value", text: value });
		card.createDiv({ cls: "editorialist-settings__stat-detail", text: detail });
	}

	private createActionButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void | Promise<void>,
	): HTMLElement {
		const button = parent.createEl("button", {
			cls: "editorialist-settings__action-button",
			attr: {
				type: "button",
			},
		});
		const iconEl = button.createSpan({ cls: "editorialist-settings__action-button-icon" });
		setIcon(iconEl, icon);
		button.createSpan({ cls: "editorialist-settings__action-button-label", text: label });
		button.addEventListener("click", () => {
			void onClick();
		});
		return button;
	}

	private formatContributorMeta(profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number]): string {
		return formatContributorIdentityLabel(profile);
	}

	private formatContributorStats(profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number]): string {
		const stats = profile.stats;
		if (!stats) {
			return "No activity yet";
		}

		return `${stats.totalSuggestions} suggestions · ${stats.accepted} accepted · ${stats.deferred ?? 0} deferred · ${stats.rejected} rejected · ${stats.unresolved} unresolved`;
	}

	private formatInventoryPathHint(record: SceneReviewRecord): string {
		return record.bookLabel ?? record.notePath;
	}

	private formatInventoryStatus(status: SceneReviewRecord["status"]): string {
		switch (status) {
			case "not_started":
				return "Not started";
			case "in_progress":
				return "In progress";
			case "completed":
				return "Completed";
			case "cleaned":
				return "Cleaned";
		}
	}

	private formatDateTime(timestamp: number): string {
		return new Date(timestamp).toLocaleString([], {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
	}
}
