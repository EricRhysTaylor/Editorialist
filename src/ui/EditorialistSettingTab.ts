import { ButtonComponent, Notice, PluginSettingTab, setIcon, type App } from "obsidian";
import {
	formatReviewerTypeLabel,
} from "../core/ContributorIdentity";
import {
	CONTRIBUTOR_ROLE_DEFINITIONS,
	getContributorStrengthDefinition,
} from "../core/ContributorStrengths";
import type { SceneReviewRecord } from "../models/ReviewerProfile";
import type EditorialistPlugin from "../main";

export class EditorialistSettingTab extends PluginSettingTab {
	private static readonly SETTINGS_DOCS_URL = "https://github.com/EricRhysTaylor/Editorialist#readme";
	private static readonly RADIAL_TIMELINE_INSTALL_URL = "obsidian://show-plugin?id=radial-timeline";
	private static readonly RADIAL_TIMELINE_REPOSITORY_URL = "https://github.com/EricRhysTaylor/Obsidian-Manuscript-Timeline";
	private static readonly RADIAL_TIMELINE_WIKI_URL = "https://github.com/EricRhysTaylor/Obsidian-Manuscript-Timeline/wiki";
	private activeBookOnly = true;
	private activeTab: "core" | "reviewer" = "core";
	private displayRunId = 0;

	constructor(
		app: App,
		private readonly plugin: EditorialistPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		void this.displayAsync(true);
	}

	private async displayAsync(refreshMetadata: boolean): Promise<void> {
		const runId = ++this.displayRunId;
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("editorialist-settings");

		if (refreshMetadata) {
			await this.plugin.syncOperationalMetadata();
		}
		if (runId !== this.displayRunId) {
			return;
		}
		const summary = this.plugin.getReviewActivitySummary();
		const activeBook = this.plugin.getActiveBookScopeInfo();
		if (!activeBook.label) {
			this.activeBookOnly = false;
		}

		if (runId !== this.displayRunId) {
			return;
		}

		const shell = containerEl.createDiv({ cls: "editorialist-settings__shell" });
		const tabBar = shell.createDiv({ cls: "editorialist-settings__tabs" });
		this.createTab(tabBar, "core", "settings", "Core");
		this.createTab(tabBar, "reviewer", "users", "Contributors");

		const coreContent = shell.createDiv({ cls: "editorialist-settings__tab-content" });
		const reviewerContent = shell.createDiv({ cls: "editorialist-settings__tab-content" });
		coreContent.toggleClass("is-hidden", this.activeTab !== "core");
		reviewerContent.toggleClass("is-hidden", this.activeTab !== "reviewer");

		const inventory = this.plugin.getSceneReviewRecords({ activeBookOnly: this.activeBookOnly });
		this.renderCoreHero(coreContent);
		if (!this.isRadialTimelineInstalled()) {
			this.renderRadialTimelineCard(coreContent);
		}
		this.renderHero(coreContent, summary, inventory);
		this.renderInventorySection(coreContent, inventory, activeBook.label);
		this.renderActivitySection(coreContent, summary);
		this.renderMaintenanceSection(coreContent, activeBook.label);

		this.renderContributorsHero(reviewerContent);
		this.renderContributorsSection(reviewerContent);
		this.renderMetadataSection(reviewerContent);
	}

	private getInventoryVocabulary(activeBook: { label: string | null; sourceFolder: string | null }): {
		hasStructuredRtContext: boolean;
		pluralLabel: string;
		pluralLabelLower: string;
		scopeLabel: string;
		singularLabel: string;
		singularLabelLower: string;
	} {
		const hasStructuredRtContext = Boolean(activeBook.sourceFolder && activeBook.label);
		if (hasStructuredRtContext) {
			return {
				hasStructuredRtContext,
				singularLabel: "Scene",
				singularLabelLower: "scene",
				pluralLabel: "Scenes",
				pluralLabelLower: "scenes",
				scopeLabel: "book",
			};
		}

		return {
			hasStructuredRtContext,
			singularLabel: "Note",
			singularLabelLower: "note",
			pluralLabel: "Notes",
			pluralLabelLower: "notes",
			scopeLabel: "vault",
		};
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
			cls: "editorialist-settings__hero-intro-badge-link editorialist-settings__rt-card-badge-link",
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
			text: "Structured editorial review in Obsidian",
		});
		hero.createDiv({
			cls: "editorialist-settings__hero-intro-subtitle",
			text: "Editorialist is a revision workspace for authors who want structured, in-context editing inside Obsidian. It brings together feedback from human editors, beta readers, and AI into one review flow, so you can compare suggestions against the manuscript before making a decision. That means fewer scattered notes, less copy-and-paste friction, and a much clearer path through revision. Every change stays under author control until accepted. It works with any vault note out of the box, whether you are revising a single chapter or managing a full manuscript.",
		});

		const features = hero.createDiv({ cls: "editorialist-settings__hero-features" });
		features.createDiv({
			cls: "editorialist-settings__hero-features-kicker",
			text: "Core highlights:",
		});
		const featureList = features.createDiv({ cls: "editorialist-settings__hero-features-list" });
		this.createHeroFeature(featureList, "table-properties", "Scene inventory — see every scene that still has revision notes and track progress at a glance.");
		this.createHeroFeature(featureList, "list-todo", "Review in context — jump straight into any scene and continue editing without searching.");
		this.createHeroFeature(featureList, "users", "Contributor tracking — keep revision identities clean, merge aliases, and preserve trustworthy editorial history.");
		this.createHeroFeature(featureList, "database-backup", "Backup your data — export contributor history and revision activity without touching your manuscript.");
	}

	private renderContributorsHero(parent: HTMLElement): void {
		const hero = parent.createDiv({
			cls: "editorialist-settings__hero-intro editorialist-settings__panel",
		});
		const badgeRow = hero.createDiv({ cls: "editorialist-settings__hero-intro-badge-row" });
		const badge = badgeRow.createSpan({ cls: "editorialist-settings__hero-intro-badge" });
		const badgeIcon = badge.createSpan({ cls: "editorialist-settings__hero-intro-badge-icon" });
		setIcon(badgeIcon, "users");
		badge.createSpan({
			cls: "editorialist-settings__hero-intro-badge-text",
			text: "Contributors · Directory",
		});
		const badgeLink = badge.createEl("a", {
			href: EditorialistSettingTab.SETTINGS_DOCS_URL,
			cls: "editorialist-settings__hero-intro-badge-link editorialist-settings__rt-card-badge-link",
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
			text: "Know which edits to trust",
		});
		hero.createDiv({
			cls: "editorialist-settings__hero-intro-subtitle",
			text: "Editorialist keeps track of who contributed each revision note so you can see what’s working and what isn’t. Whether feedback comes from a human editor, a beta reader, or AI, you can compare how often suggestions are accepted and decide which voices you want to rely on. Over time, this helps you build a clear sense of which contributors strengthen your writing and which ones to use more selectively.",
		});

		const features = hero.createDiv({ cls: "editorialist-settings__hero-features" });
		features.createDiv({
			cls: "editorialist-settings__hero-features-kicker",
			text: "Contributor highlights:",
		});
		const featureList = features.createDiv({ cls: "editorialist-settings__hero-features-list" });
		this.createHeroFeature(featureList, "users", "Contributor directory — see everyone who has helped shape your revisions, from editors to AI tools.");
		this.createHeroFeature(featureList, "shuffle", "Refine your sources — update or combine names so your contributor history stays clear and accurate.");
		this.createHeroFeature(featureList, "star", "See what works — compare how often suggestions are accepted to understand which feedback improves your writing.");
	}

	private isRadialTimelineInstalled(): boolean {
		const plugins = this.app as App & {
			plugins?: {
				enabledPlugins?: Set<string>;
				manifests?: Record<string, { id?: string; name?: string }>;
			};
		};
		const enabledPlugins = plugins.plugins?.enabledPlugins;
		if (enabledPlugins?.has("radial-timeline")) {
			return true;
		}

		const manifests = Object.values(plugins.plugins?.manifests ?? {});
		return manifests.some((manifest) => manifest.id === "radial-timeline");
	}

	private renderRadialTimelineCard(parent: HTMLElement): void {
		const card = parent.createDiv({
			cls: "editorialist-settings__rt-card editorialist-settings__panel",
		});
		const backgroundIcon = card.createDiv({ cls: "editorialist-settings__rt-card-bg-icon" });
		setIcon(backgroundIcon, "shell");

		const row = card.createDiv({ cls: "editorialist-settings__rt-card-row" });
		const content = row.createDiv({ cls: "editorialist-settings__rt-card-content" });
		const badgeRow = content.createDiv({ cls: "editorialist-settings__hero-intro-badge-row" });
		const badge = badgeRow.createSpan({ cls: "editorialist-settings__hero-intro-badge editorialist-settings__rt-card-badge" });
		const badgeIcon = badge.createSpan({ cls: "editorialist-settings__hero-intro-badge-icon" });
		setIcon(badgeIcon, "shell");
		badge.createSpan({
			cls: "editorialist-settings__hero-intro-badge-text",
			text: "Radial Timeline integration",
		});
		const wikiLink = badge.createEl("a", {
			href: EditorialistSettingTab.RADIAL_TIMELINE_WIKI_URL,
			cls: "editorialist-settings__hero-intro-badge-link editorialist-settings__rt-card-badge-link",
			attr: {
				"aria-label": "Open the Radial Timeline wiki",
				target: "_blank",
				rel: "noopener",
			},
		});
		setIcon(wikiLink, "external-link");
		content.createDiv({
			cls: "editorialist-settings__rt-card-title",
			text: "Work with scenes",
		});
		content.createDiv({
			cls: "editorialist-settings__rt-card-body",
			text: "Editorialist works with any notes, but it becomes even more useful when combined with the visual architecture of the Radial Timeline plugin for Obsidian and its scene and book project organization.",
		});

		const actions = row.createDiv({ cls: "editorialist-settings__rt-card-actions" });
		const installLink = actions.createEl("a", {
			href: EditorialistSettingTab.RADIAL_TIMELINE_INSTALL_URL,
			cls: "editorialist-settings__action-button editorialist-settings__action-button--primary",
			attr: {
				"aria-label": "Install the Radial Timeline community plugin",
				target: "_blank",
				rel: "noopener",
			},
		});
		const installIcon = installLink.createSpan({ cls: "editorialist-settings__action-button-icon" });
		setIcon(installIcon, "download");
		installLink.createSpan({
			cls: "editorialist-settings__action-button-label",
			text: "Install Radial Timeline",
		});

		const fallbackLink = actions.createEl("a", {
			href: EditorialistSettingTab.RADIAL_TIMELINE_REPOSITORY_URL,
			cls: "editorialist-settings__rt-card-fallback-link",
			text: "Open plugin page",
			attr: {
				"aria-label": "Open the Radial Timeline plugin page",
				target: "_blank",
				rel: "noopener",
			},
		});
		const fallbackIcon = fallbackLink.createSpan({ cls: "editorialist-settings__rt-card-fallback-icon" });
		setIcon(fallbackIcon, "external-link");

		card.createDiv({
			cls: "editorialist-settings__rt-card-hint",
			text: 'Find it in Community Plugins -> search "Radial Timeline"',
		});
	}

	private renderHero(
		parent: HTMLElement,
		summary: ReturnType<EditorialistPlugin["getReviewActivitySummary"]>,
		inventory: SceneReviewRecord[],
	): void {
		const hero = parent.createDiv({
			cls: "editorialist-settings__hero editorialist-settings__panel",
		});
		const titleRow = this.createSectionTitleRow(hero, "pie-chart", "Current revision");
		titleRow.addClass("editorialist-settings__section-title-row--hero");
		hero.createDiv({
			cls: "editorialist-settings__hero-subtitle",
			text: "See what remains in the current revision pass and whether there is an active sweep in progress.",
		});

		const processedCount = Math.max(0, summary.processed);
		const completionRatio = summary.totalSuggestions > 0 ? processedCount / summary.totalSuggestions : 0;
		const remainingCount = summary.pending + summary.unresolved + summary.deferred;
		const trackedScenes = inventory.filter((record) => record.batchCount > 0);
		const heroBody = hero.createDiv({ cls: "editorialist-settings__hero-body" });
		const progressCard = heroBody.createDiv({ cls: "editorialist-settings__hero-progress" });
		const ring = progressCard.createDiv({ cls: "editorialist-settings__hero-ring" });
		ring.style.setProperty("--editorialist-settings-progress", `${Math.round(completionRatio * 360)}deg`);
		const sceneGradient = this.buildSceneProgressGradient(trackedScenes);
		if (sceneGradient) {
			ring.style.setProperty("--editorialist-settings-scene-gradient", sceneGradient);
			ring.addClass("editorialist-settings__hero-ring--has-scene-slices");
		} else {
			ring.style.removeProperty("--editorialist-settings-scene-gradient");
			ring.removeClass("editorialist-settings__hero-ring--has-scene-slices");
		}
		ring.createDiv({ cls: "editorialist-settings__hero-ring-value", text: `${processedCount}/${summary.totalSuggestions}` });
		progressCard.createDiv({
			cls: "editorialist-settings__hero-progress-title",
			text: "Revisions processed",
		});
		progressCard.createDiv({
			cls: "editorialist-settings__hero-progress-detail",
			text:
				summary.totalSuggestions === 0
					? "No revision notes imported yet"
					: remainingCount === 0
						? summary.rewritten > 0
							? `Current revision complete · ${summary.rewritten} rewritten by the author`
							: "Current revision complete"
						: "Current revision progress",
		});

		const summaryGrid = heroBody.createDiv({ cls: "editorialist-settings__hero-summary" });
		this.createHeroMetric(
			summaryGrid,
			"Remaining",
			`${remainingCount}`,
			remainingCount > 0
				? `${summary.pending} pending · ${summary.unresolved} unresolved · ${summary.deferred} deferred`
				: "All revision notes in this pass are resolved",
		);
		this.createHeroMetric(summaryGrid, "Current sweep", ...this.getCurrentRevisionStatus(summary, remainingCount));
	}

	private renderActivitySection(
		parent: HTMLElement,
		summary: ReturnType<EditorialistPlugin["getReviewActivitySummary"]>,
	): void {
		const body = this.createSection(
			parent,
			"Revision history",
			"See how many revision notes have been reviewed over time and how many sweeps have been completed.",
			"activity",
		);
		const cards = body.createDiv({ cls: "editorialist-settings__stats" });

		this.createStatCard(
			cards,
			"Total suggestions",
			`${summary.totalSuggestions}`,
			"Across all revision passes",
		);
		this.createStatCard(
			cards,
			"Actions taken",
			`${summary.accepted} / ${summary.rejected} / ${summary.rewritten}`,
			"Accepted · Rejected · Rewritten",
		);
		this.createStatCard(cards, "Completed sweeps", `${summary.completedSweeps}`, `${summary.totalSweeps} total imported`);
	}

	private renderInventorySection(
		parent: HTMLElement,
		inventory: SceneReviewRecord[],
		activeBookLabel: string | null,
	): void {
		const activeBook = this.plugin.getActiveBookScopeInfo();
		const vocabulary = this.getInventoryVocabulary(activeBook);
		const body = this.createSection(
			parent,
			`${vocabulary.singularLabel} inventory`,
			`${vocabulary.pluralLabel} with revision notes and their current progress.`,
			"table-properties",
		);

		if (!vocabulary.hasStructuredRtContext) {
			const helper = body.createDiv({
				cls: "editorialist-settings__inventory-context-note",
			});
			helper.createDiv({
				cls: "editorialist-settings__inventory-context-title",
				text: "Using note-level inventory",
			});
			helper.createDiv({
				cls: "editorialist-settings__inventory-context-body",
				text: "No active Radial Timeline book context is available right now, so Editorialist is tracking review activity by note. If RT book metadata becomes available later, this inventory will tighten back to scene-aware language automatically.",
			});
		}

		if (activeBookLabel) {
			const toolbar = body.createDiv({ cls: "editorialist-settings__inventory-toolbar" });
			const actions = toolbar.createDiv({ cls: "editorialist-settings__inventory-actions" });
			const filterButton = this.createActionButton(
				actions,
				"book-open",
				this.activeBookOnly ? `Active ${vocabulary.scopeLabel}: ${activeBookLabel}` : `All ${vocabulary.scopeLabel}s`,
				async () => {
					this.activeBookOnly = !this.activeBookOnly;
					void this.displayAsync(false);
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
					? `No Editorialist ${vocabulary.singularLabelLower} records found in ${activeBookLabel}.`
					: `No Editorialist ${vocabulary.singularLabelLower} records yet.`,
			});
			return;
		}

		const tableWrap = body.createDiv({ cls: "editorialist-settings__inventory-wrap" });
		const table = tableWrap.createEl("table", { cls: "editorialist-settings__inventory-table" });
		const head = table.createTHead().insertRow();
		[
			"",
			vocabulary.singularLabel,
			"Revision notes",
			"Open",
			"Done",
		].forEach((label, index) => {
			const cell = head.createEl("th", { text: label });
			if (index === 0) {
				cell.addClass("editorialist-settings__inventory-col-completion");
				cell.setAttribute("aria-label", "Complete");
			}
			if (index >= 2) {
				cell.addClass("editorialist-settings__inventory-col-number");
			}
		});

		const bodyEl = table.createTBody();
		for (const record of inventory) {
			const openCount = record.pendingCount + record.unresolvedCount + record.deferredCount;
			const row = bodyEl.insertRow();
			const completionCell = row.createEl("td", { cls: "editorialist-settings__inventory-col-completion" });
			const completionIcon = completionCell.createSpan({
				cls: `editorialist-settings__inventory-completion${openCount === 0 ? " is-complete" : ""}`,
				attr: {
					"aria-label": openCount === 0 ? `${record.noteTitle} complete` : `${record.noteTitle} still open`,
				},
			});
			setIcon(completionIcon, openCount === 0 ? "square-check" : "square");

			const sceneCell = row.createEl("td", {
				cls: "editorialist-settings__inventory-col-scene",
			});
			const sceneLink = sceneCell.createEl("a", {
				cls: "editorialist-settings__inventory-note-link",
				text: record.noteTitle,
				attr: {
					href: "#",
					"aria-label": `Open ${record.noteTitle}`,
				},
			});
			sceneLink.addEventListener("click", (event) => {
				event.preventDefault();
				void this.plugin.openSceneNote(record.notePath);
			});
			row.createEl("td", {
				cls: "editorialist-settings__inventory-col-number",
				text: `${record.batchCount}`,
			});
			row.createEl("td", {
				cls: "editorialist-settings__inventory-col-number",
				text: `${openCount}`,
			});
			row.createEl("td", {
				cls: "editorialist-settings__inventory-col-number",
				text: `${record.acceptedCount + record.rewrittenCount}`,
			});
		}
	}

	private renderContributorsSection(parent: HTMLElement): void {
		const body = this.createSection(
			parent,
			"Contributor directory",
			"People and AI tools that have contributed revision notes across your manuscript.",
			"users",
		);
		body.parentElement?.addClass("editorialist-settings__section--primary");
		body.parentElement?.addClass("editorialist-settings__section--contributors");

		const profiles = this.plugin.getSortedReviewerProfiles();
		body.createDiv({
			cls: "editorialist-settings__section-meta",
			text: `${profiles.length} contributor${profiles.length === 1 ? "" : "s"}`,
		});

		const list = body.createDiv({ cls: "editorialist-settings__contributors" });
		if (profiles.length === 0) {
			list.createDiv({
				cls: "editorialist-settings__empty",
				text: "No contributor profiles yet.",
			});
			return;
		}

		for (const profile of profiles) {
			const card = list.createDiv({ cls: "editorialist-settings__contributor" });
			const identity = card.createDiv({ cls: "editorialist-settings__contributor-identity" });
			const main = identity.createDiv({ cls: "editorialist-settings__contributor-main" });
			this.createContributorAvatar(main, profile);
			const text = main.createDiv({ cls: "editorialist-settings__contributor-text" });
			text.createDiv({
				cls: "editorialist-settings__contributor-title",
				text: profile.displayName,
			});
			const roleLine = text.createDiv({ cls: "editorialist-settings__contributor-role-line" });
			roleLine.createSpan({
				cls: "editorialist-settings__contributor-role",
				text: formatReviewerTypeLabel(profile.reviewerType),
			});

			card.createDiv({
				cls: "editorialist-settings__contributor-stats",
				text: this.formatContributorStats(profile),
			});
			if (profile.aliases.length > 0) {
				card.createDiv({
					cls: "editorialist-settings__contributor-aliases",
					text: `Also appears as: ${profile.aliases.join(" · ")}`,
				});
			}

			const footer = card.createDiv({ cls: "editorialist-settings__contributor-footer" });
			const controls = footer.createDiv({ cls: "editorialist-settings__contributor-controls" });
			const starButton = new ButtonComponent(controls)
				.setTooltip(profile.isStarred ? "Unstar contributor" : "Star contributor")
				.onClick(() => {
					void this.plugin.toggleReviewerStarById(profile.id).then(() => this.displayAsync(false));
				});
			starButton.buttonEl.addClass("editorialist-settings__star-button");
			if (profile.isStarred) {
				starButton.buttonEl.addClass("is-starred");
			}
			const starIcon = starButton.buttonEl.createSpan({ cls: "editorialist-settings__action-button-icon" });
			setIcon(starIcon, "star");

			const manageButton = new ButtonComponent(controls)
				.setTooltip("Manage contributor")
				.onClick(() => {
					void this.plugin.openContributorManagementFlow(profile.id).then((didChange) => {
						if (didChange) {
							void this.displayAsync(false);
						}
					});
				});
			manageButton.buttonEl.addClass("editorialist-settings__star-button");
			manageButton.buttonEl.addClass("editorialist-settings__contributor-menu-button");
			const manageIcon = manageButton.buttonEl.createSpan({ cls: "editorialist-settings__action-button-icon" });
			setIcon(manageIcon, "ellipsis");

			this.renderContributorUseIcons(footer, profile);
		}

		const fillerCount = (3 - (profiles.length % 3)) % 3;
		for (let index = 0; index < fillerCount; index += 1) {
			list.createDiv({
				cls: "editorialist-settings__contributor editorialist-settings__contributor--filler",
				attr: {
					"aria-hidden": "true",
				},
			});
		}
	}

	private renderMetadataSection(parent: HTMLElement): void {
		const body = this.createSection(
			parent,
			"Backup",
			"Save your reviewer history, revision activity, and scene progress without exporting manuscript text.",
			"database-backup",
		);
		body.parentElement?.addClass("editorialist-settings__section--utility");
		const card = body.createDiv({ cls: "editorialist-settings__maintenance-card" });
		card.createDiv({
			cls: "editorialist-settings__maintenance-title",
			text: "Export Editorialist backup",
		});
		card.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: "Create a backup file with reviewer profiles, alternate names, starred reviewers, revision history, and scene progress.",
		});
		const actions = card.createDiv({ cls: "editorialist-settings__maintenance-actions" });
		this.createActionButton(actions, "download", "Export backup", async () => {
			const path = await this.plugin.exportEditorialistMetadata();
			new Notice(`Exported Editorialist metadata to ${path}.`);
		});
		card.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text: "You can keep this backup file and restore the data later if needed.",
		});
	}

	private renderMaintenanceSection(parent: HTMLElement, activeBookLabel: string | null): void {
		const activeBook = this.plugin.getActiveBookScopeInfo();
		const vocabulary = this.getInventoryVocabulary(activeBook);
		const body = this.createSection(
			parent,
			"Maintenance",
			"Use Maintenance to keep your notes clean while preserving your revision history. A common workflow is to remove review blocks after finishing a scene, while keeping the underlying history so you can track how revisions evolved over time. Editorialist adds and removes review blocks inside your notes, but your actual writing is only changed when you accept edits.",
			"wrench",
		);
		body.parentElement?.addClass("editorialist-settings__section--maintenance");

		const cleanupRow = body.createDiv({
			cls: "editorialist-settings__maintenance-row",
		});
		const cleanupInfo = cleanupRow.createDiv({
			cls: "editorialist-settings__maintenance-info",
		});
		cleanupInfo.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: activeBookLabel
				? "Remove Editorialist review blocks from scenes in the active book."
				: "Remove Editorialist review blocks from notes in the current vault.",
		});

		const cleanupActions = cleanupRow.createDiv({ cls: "editorialist-settings__maintenance-actions" });
		this.createActionButton(cleanupActions, "brush-cleaning", `Clean all ${vocabulary.pluralLabelLower}`, async () => {
			const removed = await this.plugin.cleanupAllSceneReviewNotes(this.activeBookOnly);
			void this.displayAsync(false);
			new Notice(
				removed > 0
					? `Cleaned ${removed} imported review block${removed === 1 ? "" : "s"} across ${vocabulary.pluralLabelLower}.`
					: "No imported review blocks were found to clean.",
			);
		});
		this.createActionButton(cleanupActions, "archive-x", `Clean completed ${vocabulary.pluralLabelLower}`, async () => {
			const removed = await this.plugin.cleanupCompletedSceneReviewNotes(this.activeBookOnly);
			void this.displayAsync(false);
			new Notice(
				removed > 0
					? `Cleaned ${removed} imported review block${removed === 1 ? "" : "s"} from completed ${vocabulary.pluralLabelLower}.`
					: `No completed ${vocabulary.pluralLabelLower} were ready for cleanup.`,
			);
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
			void this.displayAsync(false);
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

	private getCurrentRevisionStatus(
		summary: ReturnType<EditorialistPlugin["getReviewActivitySummary"]>,
		remainingCount: number,
	): [string, string] {
		if (remainingCount === 0 && summary.totalSuggestions > 0) {
			return ["Complete", "No revision notes remain"];
		}

		if (summary.inProgressSweeps > 0) {
			return [
				"In progress",
				`${summary.inProgressSweeps} active sweep${summary.inProgressSweeps === 1 ? "" : "s"}`,
			];
		}

		if (remainingCount > 0) {
			return ["Ready", "Revision notes remain to review"];
		}

		return ["Idle", "No active sweep right now"];
	}

	private formatContributorStats(profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number]): string {
		const stats = profile.stats;
		if (!stats) {
			return "No contribution history yet";
		}

		const acceptedRate = stats.totalSuggestions > 0
			? Math.round((stats.accepted / stats.totalSuggestions) * 100)
			: 0;
		const parts = [
			`${stats.totalSuggestions} contribution${stats.totalSuggestions === 1 ? "" : "s"}`,
			`${stats.accepted} accepted`,
		];
		if (stats.rewritten > 0) {
			parts.push(`${stats.rewritten} rewritten`);
		}
		if (stats.totalSuggestions > 0) {
			parts.push(`${acceptedRate}% acceptance`);
		}
		if (stats.totalSuggestions >= 5 && acceptedRate >= 80) {
			parts.push("trusted");
		}
		return parts.join(" • ");
	}

	private buildSceneProgressGradient(records: SceneReviewRecord[]): string | null {
		if (records.length === 0) {
			return null;
		}

		const sliceAngle = 360 / records.length;
		const completeColor = "color-mix(in srgb, var(--color-green) 46%, var(--background-primary) 54%)";
		const incompleteColor = "color-mix(in srgb, var(--background-modifier-border) 72%, transparent)";
		const segments: string[] = [];
		let currentAngle = 0;

		for (const record of records) {
			const sliceStart = currentAngle;
			const sliceEnd = currentAngle + sliceAngle;
			const totalSuggestions =
				record.pendingCount +
				record.unresolvedCount +
				record.deferredCount +
				record.acceptedCount +
				record.rejectedCount +
				record.rewrittenCount;
			const processedSuggestions = record.acceptedCount + record.rejectedCount + record.rewrittenCount;
			const processedRatio = totalSuggestions > 0 ? Math.min(1, processedSuggestions / totalSuggestions) : 0;
			const processedEnd = sliceStart + (sliceAngle * processedRatio);

			if (processedRatio > 0) {
				segments.push(`${completeColor} ${sliceStart}deg ${processedEnd}deg`);
			}

			if (processedEnd < sliceEnd) {
				segments.push(`${incompleteColor} ${processedEnd}deg ${sliceEnd}deg`);
			}

			currentAngle = sliceEnd;
		}

		return `conic-gradient(${segments.join(", ")})`;
	}

	private createContributorAvatar(
		parent: HTMLElement,
		profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number],
	): void {
		const avatar = parent.createDiv({
			cls: `editorialist-settings__contributor-avatar${profile.kind === "ai" ? " is-ai" : ""}${profile.isStarred ? " is-starred" : ""}`,
		});
		const icon = avatar.createSpan({ cls: "editorialist-settings__contributor-avatar-icon" });
		setIcon(icon, profile.isStarred ? "user-star" : profile.kind === "ai" ? "cpu" : "user-round");
	}

	private renderContributorUseIcons(
		parent: HTMLElement,
		profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number],
	): void {
		const icons = parent.createDiv({ cls: "editorialist-settings__contributor-use-icons" });
		const roleDefinition = CONTRIBUTOR_ROLE_DEFINITIONS.find((definition) => definition.value === profile.reviewerType);
		if (roleDefinition) {
			const roleIcon = icons.createSpan({
				cls: "editorialist-settings__contributor-use-icon editorialist-settings__contributor-use-icon--role",
				attr: {
					"aria-label": roleDefinition.label,
					title: roleDefinition.label,
				},
			});
			setIcon(roleIcon, roleDefinition.icon);
		}

		for (const strength of profile.strengths ?? []) {
			const definition = getContributorStrengthDefinition(strength);
			if (!definition) {
				continue;
			}

			const strengthIcon = icons.createSpan({
				cls: "editorialist-settings__contributor-use-icon",
				attr: {
					"aria-label": definition.label,
					title: definition.label,
				},
			});
			setIcon(strengthIcon, definition.icon);
		}
	}

}
