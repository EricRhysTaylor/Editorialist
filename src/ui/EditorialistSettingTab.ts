import { ButtonComponent, Notice, PluginSettingTab, setIcon, TFile, type App } from "obsidian";
import {
	formatReviewerTypeLabel,
	normalizeContributorValue,
} from "../core/ContributorIdentity";
import {
	renderContributorBrandMark,
	type ContributorBrand,
} from "../core/ContributorBrandMarks";
import {
	CONTRIBUTOR_ROLE_DEFINITIONS,
	getContributorStrengthDefinition,
} from "../core/ContributorStrengths";
import { getFrontmatterStringValues } from "../core/VaultScope";
import type { ReviewSweepRegistryEntry } from "../models/ReviewImport";
import type { SceneReviewRecord } from "../models/ReviewerProfile";
import type EditorialistPlugin from "../main";
import { openEditorialistChoiceModal } from "./EditorialistChoiceModal";

export class EditorialistSettingTab extends PluginSettingTab {
	private static readonly SETTINGS_DOCS_URL = "https://github.com/EricRhysTaylor/Editorialist#readme";
	private static readonly RADIAL_TIMELINE_INSTALL_URL = "obsidian://show-plugin?id=radial-timeline";
	private static readonly RADIAL_TIMELINE_REPOSITORY_URL = "https://github.com/EricRhysTaylor/Obsidian-Manuscript-Timeline";
	private static readonly RADIAL_TIMELINE_WIKI_URL = "https://github.com/EricRhysTaylor/Obsidian-Manuscript-Timeline/wiki";
	private activeBookOnly = true;
	private activeTab: "core" | "reviewer" = "core";
	private displayRunId = 0;

	private static readonly RT_STATUS_GLYPH_DEFINITIONS = [
		{ glyph: "T", label: "Todo", tone: "todo", values: ["todo", "to do", "t"] },
		{ glyph: "W", label: "Working", tone: "working", values: ["working", "in progress", "draft", "w"] },
		{ glyph: "C", label: "Complete", tone: "complete", values: ["complete", "completed", "done", "final", "c"] },
	] as const;

	private static readonly RT_STAGE_GLYPH_DEFINITIONS = [
		{ glyph: "Z", label: "Zero", tone: "zero", values: ["zero", "z"] },
		{ glyph: "A", label: "Author", tone: "author", values: ["author", "a"] },
		{ glyph: "H", label: "House", tone: "house", values: ["house", "h"] },
		{ glyph: "P", label: "Press", tone: "press", values: ["press", "p"] },
	] as const;

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
		await this.plugin.refreshPendingEditsSummary({ force: refreshMetadata });
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
		this.renderPendingEditsSection(coreContent);
		this.renderActivitySection(coreContent, summary);
		this.renderTrackingSection(coreContent, activeBook);
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
		this.createHeroFeature(featureList, "pen-tool", "Review in context — jump straight into any scene and continue editing without searching.");
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

	private renderTrackingSection(
		parent: HTMLElement,
		activeBook: { label: string | null; sourceFolder: string | null },
	): void {
		const summary = this.plugin.getTrackingIdentitySummary({ activeBookOnly: this.activeBookOnly });
		const vocabulary = this.getInventoryVocabulary(activeBook);
		const hasRtTrackingContext = this.isRadialTimelineInstalled() && Boolean(activeBook.label && activeBook.sourceFolder);
		const body = this.createSection(
			parent,
			vocabulary.hasStructuredRtContext ? "Tracking scenes" : "Tracking notes",
			"Editorialist uses stable note identity to keep revision history attached to the right scene or note as your manuscript changes.",
			"fingerprint",
		);

		const card = body.createDiv({ cls: "editorialist-settings__maintenance-card" });
		const row = card.createDiv({ cls: "editorialist-settings__maintenance-row" });
		const info = row.createDiv({ cls: "editorialist-settings__maintenance-info" });

		const unitLabel = summary.trackedCount === 1 ? vocabulary.singularLabelLower : vocabulary.pluralLabelLower;
		const trackedLabel = summary.trackedCount > 0 ? `${summary.trackedCount} tracked ${unitLabel}` : `No tracked ${unitLabel} yet`;

		if (hasRtTrackingContext) {
			info.createDiv({
				cls: "editorialist-settings__maintenance-title",
				text: "Radial Timeline based tracking",
			});
			info.createDiv({
				cls: "editorialist-settings__maintenance-description",
				text: "Radial Timeline gives Editorialist stable scene IDs in the active book, so revision history stays attached to the right scene even when titles change or scenes are reordered.",
			});
			const actions = row.createDiv({ cls: "editorialist-settings__maintenance-actions" });
			const badge = actions.createDiv({
				cls: "editorialist-settings__tracking-badge editorialist-settings__tracking-badge--rt",
			});
			const badgeIcon = badge.createSpan({ cls: "editorialist-settings__tracking-badge-icon" });
			setIcon(badgeIcon, "shell");
			badge.createSpan({
				cls: "editorialist-settings__tracking-badge-label",
				text: "Radial Timeline",
			});
			card.createDiv({
				cls: "editorialist-settings__maintenance-note",
				text:
					summary.trackedCount > 0
						? trackedLabel
						: "When scenes are tracked in this book, Editorialist will validate them against Radial Timeline scene IDs.",
			});
			return;
		}

		if (summary.mode === "editorial-note-ids" || summary.mode === "frontmatter-ids") {
			info.createDiv({
				cls: "editorialist-settings__maintenance-title",
				text: "Using stable note IDs",
			});
			info.createDiv({
				cls: "editorialist-settings__maintenance-description",
				text:
					summary.mode === "editorial-note-ids"
						? "Editorialist is using injected note IDs for rename-safe tracking, so note titles and folder moves do not split revision history."
						: "Editorialist found stable note IDs in frontmatter, so note renames do not break revision history.",
			});
			card.createDiv({
				cls: "editorialist-settings__maintenance-note",
				text: trackedLabel,
			});
			return;
		}

		info.createDiv({
			cls: "editorialist-settings__maintenance-title",
			text: "Path-based tracking fallback",
		});
		info.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: "This vault is currently falling back to note paths. For accurate rename-safe tracking outside Radial Timeline, inject stable note IDs into tracked notes.",
		});
		const actions = row.createDiv({ cls: "editorialist-settings__maintenance-actions" });
		this.createActionButton(actions, "fingerprint", "Inject stable note IDs", async () => {
			if (!(await this.confirmDestructiveAction({
				title: "Inject stable note IDs",
				description: `This adds an \`editorial_id\` frontmatter field to tracked ${vocabulary.pluralLabelLower} that do not already have a stable ID.`,
				confirmLabel: "Inject IDs",
			}))) {
				return;
			}

			const injectedCount = await this.plugin.injectStableNoteIdsIntoTrackedNotes(this.activeBookOnly);
			void this.displayAsync(false);
			new Notice(
				injectedCount > 0
					? `Injected stable note IDs into ${injectedCount} tracked ${injectedCount === 1 ? vocabulary.singularLabelLower : vocabulary.pluralLabelLower}.`
					: "All tracked notes already had stable IDs.",
			);
		});
		card.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text:
				summary.trackedCount > 0
					? `${trackedLabel} · ${summary.missingCount} still depend on note paths.`
					: `When you start tracking ${vocabulary.pluralLabelLower}, Editorialist can inject stable note IDs here.`,
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

		const trackedScenes = inventory.filter((record) => record.batchCount > 0);
		const currentSummary = trackedScenes.reduce(
			(totals, record) => {
				totals.totalSuggestions +=
					record.pendingCount +
					record.unresolvedCount +
					record.deferredCount +
					record.acceptedCount +
					record.rejectedCount +
					record.rewrittenCount;
				totals.pending += record.pendingCount;
				totals.unresolved += record.unresolvedCount;
				totals.deferred += record.deferredCount;
				totals.accepted += record.acceptedCount;
				totals.rejected += record.rejectedCount;
				totals.rewritten += record.rewrittenCount;
				return totals;
			},
			{
				totalSuggestions: 0,
				pending: 0,
				unresolved: 0,
				deferred: 0,
				accepted: 0,
				rejected: 0,
				rewritten: 0,
			},
		);
		const processedCount = Math.max(
			0,
			currentSummary.accepted + currentSummary.rejected + currentSummary.rewritten,
		);
		const completionRatio = currentSummary.totalSuggestions > 0 ? processedCount / currentSummary.totalSuggestions : 0;
		const remainingCount = currentSummary.pending + currentSummary.unresolved + currentSummary.deferred;
		const currentRevisionStatus = {
			...summary,
			totalSuggestions: currentSummary.totalSuggestions,
			pending: currentSummary.pending,
			unresolved: currentSummary.unresolved,
			deferred: currentSummary.deferred,
			accepted: currentSummary.accepted,
			rejected: currentSummary.rejected,
			rewritten: currentSummary.rewritten,
			processed: processedCount,
			inProgressSweeps: trackedScenes.length > 0 ? summary.inProgressSweeps : 0,
		};
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
		ring.createDiv({ cls: "editorialist-settings__hero-ring-value", text: `${processedCount}/${currentSummary.totalSuggestions}` });
		progressCard.createDiv({
			cls: "editorialist-settings__hero-progress-title",
			text: "Revisions processed",
		});
		progressCard.createDiv({
			cls: "editorialist-settings__hero-progress-detail",
			text:
				currentSummary.totalSuggestions === 0
					? "No revision notes imported yet"
					: remainingCount === 0
						? currentSummary.rewritten > 0
							? `Current revision complete · ${currentSummary.rewritten} rewritten by the author`
							: "Current revision complete"
						: "Current revision progress",
		});

		const summaryGrid = heroBody.createDiv({ cls: "editorialist-settings__hero-summary" });
		this.createHeroMetric(
			summaryGrid,
			"Remaining",
			`${remainingCount}`,
			remainingCount > 0
				? `${currentSummary.pending} pending · ${currentSummary.unresolved} unresolved · ${currentSummary.deferred} deferred`
				: "All revision notes in this pass are resolved",
		);
		this.createHeroMetric(summaryGrid, "Current sweep", ...this.getCurrentRevisionStatus(currentRevisionStatus, remainingCount));
	}

	private renderPendingEditsSection(parent: HTMLElement): void {
		const summary = this.plugin.getPendingEditsSummary();
		const radialTimelineInstalled = this.isRadialTimelineInstalled();

		if (!radialTimelineInstalled && !summary) {
			return;
		}

		const body = this.createSection(
			parent,
			"Pending edits",
			"Free-form revision notes from your active book's scene frontmatter. Reviewed separately from imported revision passes. Edit each line item (human note plus one or more Inquiry View items) in order as they appear.",
			"clipboard-list",
		);

		const cards = body.createDiv({ cls: "editorialist-settings__stats" });

		const sceneCount = summary?.sceneCount ?? 0;
		const segmentCount = summary?.segmentCount ?? 0;
		const humanCount = summary?.humanCount ?? 0;
		const inquiryCount = summary?.inquiryCount ?? 0;

		this.createStatCard(
			cards,
			"Scenes",
			`${sceneCount}`,
			sceneCount === 0 ? "No scenes with pending edits" : "With pending edits in active book",
		);
		this.createStatCard(
			cards,
			"Items",
			`${segmentCount}`,
			segmentCount === 0
				? "Human notes and Inquiry insertions will appear here"
				: `${humanCount} human · ${inquiryCount} inquiry`,
		);

		const actionCard = cards.createDiv({
			cls: "editorialist-settings__stat-card editorialist-settings__stat-card--action",
		});
		actionCard.createDiv({ cls: "editorialist-settings__stat-label", text: "Action" });
		actionCard.createDiv({
			cls: "editorialist-settings__stat-detail",
			text: segmentCount === 0
				? "Nothing to review right now"
				: "Walk each item across the active book",
		});
		const actionFooter = actionCard.createDiv({ cls: "editorialist-settings__stat-action-footer" });
		const startButton = this.createActionButton(actionFooter, "play", "Start review", async () => {
			await this.plugin.startPendingEditsReview();
		});
		if (segmentCount === 0) {
			startButton.setAttribute("disabled", "true");
			startButton.setAttribute("aria-disabled", "true");
		}
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
		const liveInventory = inventory.filter((record) => record.batchCount > 0);
		const activeBook = this.plugin.getActiveBookScopeInfo();
		const vocabulary = this.getInventoryVocabulary(activeBook);
		const showRtSceneGlyphs = this.shouldRenderRtSceneGlyphs(activeBook);
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
			const titleRow = this.getSectionTitleRow(body);
			const host = titleRow ?? body.createDiv({ cls: "editorialist-settings__inventory-toolbar" });
			const filterButton = this.createActionButton(
				host,
				"book-open",
				this.activeBookOnly ? `Active ${vocabulary.scopeLabel}: ${activeBookLabel}` : `All ${vocabulary.scopeLabel}s`,
				async () => {
					this.activeBookOnly = !this.activeBookOnly;
					void this.displayAsync(false);
				},
			);
			filterButton.addClass("editorialist-settings__inventory-filter");
			if (titleRow) {
				filterButton.addClass("editorialist-settings__section-header-action");
			}
			if (this.activeBookOnly) {
				filterButton.addClass("is-active");
			}
		}

		if (liveInventory.length === 0) {
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
			"Revisions",
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
		for (const record of liveInventory) {
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
			const sceneEntry = sceneCell.createDiv({
				cls: "editorialist-settings__inventory-scene-entry",
			});
			if (showRtSceneGlyphs) {
				const rtGlyphs = this.getRtSceneGlyphState(record.notePath);
				if (rtGlyphs) {
					this.createInventoryRtGlyph(
						sceneEntry,
						rtGlyphs.status.glyph,
						rtGlyphs.status.label,
						rtGlyphs.status.tone,
						"status",
					);
					this.createInventoryRtGlyph(
						sceneEntry,
						rtGlyphs.stage.glyph,
						rtGlyphs.stage.label,
						rtGlyphs.stage.tone,
						"stage",
					);
				}
			}
			const sceneLink = sceneEntry.createEl("a", {
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
			if (this.plugin.hasPendingEditsForScene(record.notePath)) {
				const badge = sceneEntry.createSpan({
					cls: "editorialist-settings__inventory-pending-badge",
					attr: {
						"aria-label": "Pending edits on this scene",
						title: "This scene also has pending edits (free-form revision notes).",
					},
				});
				const badgeIcon = badge.createSpan({ cls: "editorialist-settings__inventory-pending-badge-icon" });
				setIcon(badgeIcon, "clipboard-list");
				badge.createSpan({
					cls: "editorialist-settings__inventory-pending-badge-text",
					text: "pending",
				});
			}
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

	private shouldRenderRtSceneGlyphs(activeBook: { label: string | null; sourceFolder: string | null }): boolean {
		return this.isRadialTimelineInstalled() && Boolean(activeBook.label && activeBook.sourceFolder);
	}

	private getRtSceneGlyphState(notePath: string):
		| {
				status: { glyph: string; label: string; tone: string };
				stage: { glyph: string; label: string; tone: string };
		  }
		| null {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return null;
		}

		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		if (!frontmatter) {
			return null;
		}

		const status = this.resolveRtGlyphValue(
			frontmatter,
			[
				"status",
				"Status",
				"scene_status",
				"sceneStatus",
				"SceneStatus",
				"manuscript_status",
				"manuscriptStatus",
				"ManuscriptStatus",
			],
			EditorialistSettingTab.RT_STATUS_GLYPH_DEFINITIONS,
		);
		const stage = this.resolveRtGlyphValue(
			frontmatter,
			[
				"stage",
				"Stage",
				"scene_stage",
				"sceneStage",
				"SceneStage",
				"manuscript_stage",
				"manuscriptStage",
				"ManuscriptStage",
				"publishing_stage",
				"publishingStage",
				"PublishingStage",
			],
			EditorialistSettingTab.RT_STAGE_GLYPH_DEFINITIONS,
		);

		if (!status || !stage) {
			return null;
		}

		return { status, stage };
	}

	private resolveRtGlyphValue(
		frontmatter: Record<string, unknown>,
		keys: string[],
		definitions: ReadonlyArray<{
			glyph: string;
			label: string;
			tone: string;
			values: readonly string[];
		}>,
	): { glyph: string; label: string; tone: string } | null {
		const values = getFrontmatterStringValues(frontmatter, keys);
		for (const rawValue of values) {
			const normalizedValue = rawValue.trim().toLowerCase();
			const definition = definitions.find((candidate) => candidate.values.includes(normalizedValue));
			if (definition) {
				return {
					glyph: definition.glyph,
					label: definition.label,
					tone: definition.tone,
				};
			}
		}

		return null;
	}

	private createInventoryRtGlyph(
		parent: HTMLElement,
		glyph: string,
		label: string,
		tone: string,
		kind: "status" | "stage",
	): void {
		parent.createSpan({
			cls: `editorialist-settings__inventory-rt-glyph editorialist-settings__inventory-rt-glyph--${kind} editorialist-settings__inventory-rt-glyph--${tone}`,
			text: glyph,
			attr: {
				"aria-label": label,
				title: label,
			},
		});
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
			this.renderContributorUseIcons(roleLine, profile, { inline: true });

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
		const grid = body.createDiv({ cls: "editorialist-settings__maintenance-grid" });

		const backupCard = grid.createDiv({ cls: "editorialist-settings__maintenance-card" });
		backupCard.createDiv({
			cls: "editorialist-settings__maintenance-title",
			text: "Backup",
		});
		backupCard.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: "Create a backup file with reviewer profiles, alternate names, starred reviewers, revision history, and scene progress.",
		});
		const backupActions = backupCard.createDiv({ cls: "editorialist-settings__maintenance-actions" });
		this.createActionButton(backupActions, "download", "Export backup", async () => {
			const path = await this.plugin.exportEditorialistMetadata();
			new Notice(`Exported Editorialist metadata to ${path}.`);
		});
		backupCard.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text: "You can keep this backup file and restore the data later if needed.",
		});

		const resetCard = grid.createDiv({ cls: "editorialist-settings__maintenance-card" });
		resetCard.createDiv({
			cls: "editorialist-settings__maintenance-title",
			text: "Reset",
		});
		resetCard.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: "Delete contributor profiles and clear saved contributor stats when you need to unwind duplicate or throwaway contributor data.",
		});
		const resetActions = resetCard.createDiv({ cls: "editorialist-settings__maintenance-actions" });
		this.createActionButton(resetActions, "users", "Delete all contributors", async () => {
			const removedCount = await this.plugin.deleteAllContributors();
			if (removedCount > 0) {
				void this.displayAsync(false);
			}
		});
		resetCard.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text: "This clears the contributor directory and saved contributor stats, but leaves revision decisions and scene history in place.",
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
			if (!(await this.confirmDestructiveAction({
				title: `Clean all ${vocabulary.pluralLabelLower}`,
				description: `This removes imported Editorialist review blocks from tracked ${vocabulary.pluralLabelLower}. Accepted manuscript edits and saved review history stay in place.`,
				confirmLabel: `Clean all ${vocabulary.pluralLabelLower}`,
			}))) {
				return;
			}

			const removed = await this.plugin.cleanupAllSceneReviewNotes(this.activeBookOnly);
			void this.displayAsync(false);
			new Notice(
				removed > 0
					? `Cleaned ${removed} imported review block${removed === 1 ? "" : "s"} across ${vocabulary.pluralLabelLower}.`
					: "No imported review blocks were found to clean.",
			);
		});
		this.createActionButton(cleanupActions, "archive-x", `Clean completed ${vocabulary.pluralLabelLower}`, async () => {
			if (!(await this.confirmDestructiveAction({
				title: `Clean completed ${vocabulary.pluralLabelLower}`,
				description: `This removes imported Editorialist review blocks only from completed ${vocabulary.pluralLabelLower}. Accepted manuscript edits and saved review history stay in place.`,
				confirmLabel: `Clean completed ${vocabulary.pluralLabelLower}`,
			}))) {
				return;
			}

			const removed = await this.plugin.cleanupCompletedSceneReviewNotes(this.activeBookOnly);
			void this.displayAsync(false);
			new Notice(
				removed > 0
					? `Cleaned ${removed} imported review block${removed === 1 ? "" : "s"} from completed ${vocabulary.pluralLabelLower}.`
					: `No completed ${vocabulary.pluralLabelLower} were ready for cleanup.`,
			);
		});

		const historyCard = body.createDiv({ cls: "editorialist-settings__maintenance-card" });
		const historyRow = historyCard.createDiv({
			cls: "editorialist-settings__maintenance-row editorialist-settings__maintenance-row--reset",
		});
		const historyInfo = historyRow.createDiv({
			cls: "editorialist-settings__maintenance-info",
		});
		historyInfo.createDiv({
			cls: "editorialist-settings__maintenance-title",
			text: "Reset saved revision history",
		});
		historyInfo.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: "Use this if a pass was imported twice or you need to unwind saved stats. Imported review blocks still inside notes will be discovered again on the next sync.",
		});
		const historyFooter = historyCard.createDiv({
			cls: "editorialist-settings__maintenance-row editorialist-settings__maintenance-row--footer",
		});
		historyFooter.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text: "Resetting history clears Editorialist’s saved decisions and batch tracking, not the review blocks currently written into notes.",
		});
		const historyActions = historyFooter.createDiv({
			cls: "editorialist-settings__maintenance-actions editorialist-settings__maintenance-actions--reset-footer",
		});
		this.createActionButton(historyActions, "history", "Reset one batch", async () => {
			await this.handleResetSingleBatch();
		});
		this.createActionButton(historyActions, "rotate-ccw", "Reset all history", async () => {
			await this.handleResetAllHistory();
		});
	}

	private async handleResetSingleBatch(): Promise<void> {
		const entries = this.plugin.getSweepRegistryEntries();
		if (entries.length === 0) {
			new Notice("No saved revision batches were found.");
			return;
		}

		const batchId = await openEditorialistChoiceModal(this.app, {
			title: "Reset one batch",
			description: "Choose which imported revision pass to remove from saved Editorialist history.",
			choices: entries.slice(0, 12).map((entry) => ({
				label: this.formatSweepChoiceLabel(entry),
				value: entry.batchId,
			})),
		});
		if (!batchId) {
			return;
		}

		const confirm = await openEditorialistChoiceModal(this.app, {
			title: "Confirm reset",
			description: "This removes the saved decisions and stats for that batch. Review blocks still present in notes will be discovered again.",
			choices: [
				{ label: "Reset batch", value: "reset" },
				{ label: "Cancel", value: "cancel" },
			],
		});
		if (confirm !== "reset") {
			return;
		}

		const result = await this.plugin.resetBatchHistory(batchId);
		void this.displayAsync(false);
		new Notice(
			result.removedDecisions > 0 || result.removedSignals > 0 || result.removedSweep
				? "Reset saved history for that batch."
				: "No saved history was found for that batch.",
		);
	}

	private async handleResetAllHistory(): Promise<void> {
		const confirm = await openEditorialistChoiceModal(this.app, {
			title: "Reset all revision history",
			description: "This clears Editorialist’s saved batch history and decision stats. Review blocks still present in notes will be discovered again.",
			choices: [
				{ label: "Reset all history", value: "reset" },
				{ label: "Cancel", value: "cancel" },
			],
		});
		if (confirm !== "reset") {
			return;
		}

		const result = await this.plugin.resetAllRevisionHistory();
		void this.displayAsync(false);
		new Notice(
			result.removedDecisions > 0 || result.removedSignals > 0 || result.removedSweeps > 0
				? "Reset all saved revision history."
				: "No saved revision history was found.",
		);
	}

	private async confirmDestructiveAction(options: {
		title: string;
		description: string;
		confirmLabel: string;
	}): Promise<boolean> {
		const choice = await openEditorialistChoiceModal(this.app, {
			title: options.title,
			description: options.description,
			choices: [
				{ label: options.confirmLabel, value: "confirm" },
				{ label: "Cancel", value: "cancel" },
			],
		});

		return choice === "confirm";
	}

	private formatSweepChoiceLabel(entry: ReviewSweepRegistryEntry): string {
		const dateLabel = new Date(entry.importedAt).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
		const sceneCount = entry.sceneOrder.length;
		const sceneLabel = sceneCount === 1 ? "scene" : "scenes";
		const statusLabel = entry.status === "in_progress" ? "In progress" : entry.status === "completed" ? "Complete" : "Cleaned";
		return `${dateLabel} · ${entry.totalSuggestions} edits · ${sceneCount} ${sceneLabel} · ${statusLabel}`;
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

	private getSectionTitleRow(body: HTMLElement): HTMLElement | null {
		const section = body.parentElement;
		if (!section) {
			return null;
		}
		const header = section.querySelector(".editorialist-settings__section-header");
		if (!header) {
			return null;
		}
		return header.querySelector(".editorialist-settings__section-title-row");
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
		const gapColor = "color-mix(in srgb, var(--background-modifier-border) 40%, transparent)";
		const segments: string[] = [];
		let currentAngle = 0;

		for (const record of records) {
			const sliceStart = currentAngle;
			const sliceEnd = currentAngle + sliceAngle;
			const gapDegrees = records.length > 1 ? Math.min(2, sliceAngle * 0.14) : 0;
			const visualStart = Math.min(sliceEnd, sliceStart + gapDegrees / 2);
			const visualEnd = Math.max(visualStart, sliceEnd - gapDegrees / 2);
			const totalSuggestions =
				record.pendingCount +
				record.unresolvedCount +
				record.deferredCount +
				record.acceptedCount +
				record.rejectedCount +
				record.rewrittenCount;
			const processedSuggestions = record.acceptedCount + record.rejectedCount + record.rewrittenCount;
			const processedRatio = totalSuggestions > 0 ? Math.min(1, processedSuggestions / totalSuggestions) : 0;
			const visualSpan = Math.max(0, visualEnd - visualStart);
			const processedEnd = visualStart + (visualSpan * processedRatio);

			if (sliceStart < visualStart) {
				segments.push(`${gapColor} ${sliceStart}deg ${visualStart}deg`);
			}

			if (processedRatio > 0) {
				segments.push(`${completeColor} ${visualStart}deg ${processedEnd}deg`);
			}

			if (processedEnd < visualEnd) {
				segments.push(`${incompleteColor} ${processedEnd}deg ${visualEnd}deg`);
			}

			if (visualEnd < sliceEnd) {
				segments.push(`${gapColor} ${visualEnd}deg ${sliceEnd}deg`);
			}

			currentAngle = sliceEnd;
		}

		return `conic-gradient(${segments.join(", ")})`;
	}

	private createContributorAvatar(
		parent: HTMLElement,
		profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number],
	): void {
		const aiBrand = profile.kind === "ai" ? this.getContributorAvatarBrand(profile) : null;
		const avatar = parent.createDiv({
			cls: `editorialist-settings__contributor-avatar${profile.kind === "ai" ? " is-ai" : ""}${profile.isStarred ? " is-starred" : ""}${aiBrand ? ` is-provider-${aiBrand}` : ""}`,
		});
		const icon = avatar.createSpan({ cls: "editorialist-settings__contributor-avatar-icon" });
		if (profile.kind === "ai") {
			const brand = this.getContributorAvatarBrand(profile);
			if (brand === "generic") {
				setIcon(icon, "cpu");
				return;
			}

			icon.addClass("is-brand");
			renderContributorBrandMark(icon, brand);
			return;
		}

		setIcon(icon, profile.isStarred ? "user-star" : "user-round");
	}

	private getContributorAvatarBrand(
		profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number],
	): ContributorBrand | "generic" {
		const signature = normalizeContributorValue([
			profile.provider,
			profile.model,
			profile.displayName,
			...profile.aliases,
		].filter((value): value is string => Boolean(value?.trim())).join(" "));

		if (signature.includes("claude") || signature.includes("anthropic")) {
			return "anthropic";
		}

		if (signature.includes("gemini") || signature.includes("google")) {
			return "gemini";
		}

		if (signature.includes("grok") || signature.includes("xai") || signature.includes("x ai")) {
			return "grok";
		}

		if (
			signature.includes("openai")
			|| signature.includes("chatgpt")
			|| /\bgpt\b/.test(signature)
			|| /\bo[134]\b/.test(signature)
		) {
			return "openai";
		}

		return "generic";
	}

	private renderContributorUseIcons(
		parent: HTMLElement,
		profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number],
		options?: { inline?: boolean },
	): void {
		const icons = parent.createDiv({
			cls: `editorialist-settings__contributor-use-icons${options?.inline ? " editorialist-settings__contributor-use-icons--inline" : ""}`,
		});
		const roleDefinition = CONTRIBUTOR_ROLE_DEFINITIONS.find((definition) => definition.value === profile.reviewerType);
		if (roleDefinition) {
			const roleIcon = icons.createSpan({
				cls: `editorialist-settings__contributor-use-icon${options?.inline ? " editorialist-settings__contributor-use-icon--inline" : " editorialist-settings__contributor-use-icon--role-button"}`,
				attr: {
					"aria-label": roleDefinition.label,
					title: roleDefinition.label,
				},
			});
			setIcon(roleIcon, roleDefinition.icon);
		}

		if ((profile.strengths?.length ?? 0) === 0) {
			return;
		}

		for (const strength of profile.strengths ?? []) {
			const definition = getContributorStrengthDefinition(strength);
			if (!definition) {
				continue;
			}

			const strengthIcon = icons.createSpan({
				cls: `editorialist-settings__contributor-use-icon${options?.inline ? " editorialist-settings__contributor-use-icon--inline" : ""}`,
				attr: {
					"aria-label": definition.label,
					title: definition.label,
				},
			});
			setIcon(strengthIcon, definition.icon);
		}
	}

}
