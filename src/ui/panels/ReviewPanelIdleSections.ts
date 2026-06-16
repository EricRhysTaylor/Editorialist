// Idle / completion / workspace section renderers for ReviewPanel.
//
// Extracted from ReviewPanel.ts (Pass 21) to shrink the 2,000-line file
// without changing rendering behavior. Every function in this module is a
// 1:1 move of a former `private render*` / `private format*` method on
// ReviewPanel — DOM structure, class names, callbacks, and call order are
// preserved exactly. The split scope is intentionally narrow: only the
// !session branch sections of ReviewPanel.render() and the completed-sweep
// card. Active-session rendering (suggestion cards, filters, panel-only
// state, handoff card) stays in ReviewPanel.ts and is unaffected.
//
// Each renderer takes its dependencies explicitly via the `host` interface +
// plugin + parent element. The viewmodel layer
// (src/ui/viewmodels/ReviewPanelViewModel.ts) already pins which branch
// fires; this module owns the render bodies the panel dispatches to.

import { setIcon } from "obsidian";
import { renderContributorBrandMark, resolveContributorBrand } from "../../core/ContributorBrandMarks";
import { formatReviewerTypeLabel } from "../../core/ContributorIdentity";
import { isPathInFolderScope } from "../../core/VaultScope";
import { isBatchReadyToClean } from "../../core/review/SweepCompletion";
import type EditorialistPlugin from "../../main";

// Re-exported for callers that historically imported it from this module.
export { isBatchReadyToClean };

// Minimal callback surface ReviewPanel exposes to these renderers. Matches
// what was previously reached via `this.*` inside the moved methods.
export interface IdleSectionsHost {
	bindAction(element: HTMLElement, onClick: () => void): void;
	requestRender(): void;
	getOnboardingExpanded(): boolean | null;
	setOnboardingExpanded(value: boolean): void;
	getPendingEditsExpanded(): boolean;
	setPendingEditsExpanded(value: boolean): void;
}

// ── completed sweep ──────────────────────────────────────────────────────

export function renderCompletedSweepCard(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	parent: HTMLElement,
	completedSweep: ReturnType<EditorialistPlugin["getCompletedSweepPanelState"]>,
): void {
	if (!completedSweep) {
		return;
	}

	const card = parent.createDiv({ cls: "editorialist-panel__completion" });
	const bgIcon = card.createSpan({ cls: "editorialist-panel__completion-bg-icon" });
	setIcon(bgIcon, "pen-tool");

	const titleRow = card.createDiv({ cls: "editorialist-panel__completion-title-row" });
	const titleIcon = titleRow.createSpan({ cls: "editorialist-panel__completion-title-icon" });
	setIcon(titleIcon, "pen-tool");
	titleRow.createSpan({
		cls: "editorialist-panel__completion-title",
		text: completedSweep.title,
	});

	card.createDiv({
		cls: "editorialist-panel__completion-summary",
		text: completedSweep.editsReviewedLabel,
	});
	if (completedSweep.durationLabel) {
		card.createDiv({
			cls: "editorialist-panel__completion-duration",
			text: completedSweep.durationLabel,
		});
	}
	card.createDiv({
		cls: "editorialist-panel__completion-description",
		text: completedSweep.description,
	});

	const steps = card.createDiv({ cls: "editorialist-panel__completion-steps" });
	completedSweep.nextSteps.forEach((step, index) => {
		const item = steps.createDiv({ cls: "editorialist-panel__completion-step" });
		if (index === 0) {
			item.addClass("is-primary");
		}
		const bullet = item.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
		setIcon(bullet, "arrow-right");

		if (step.action === "import") {
			const link = item.createEl("a", {
				cls: "editorialist-panel__completion-step-link",
				attr: {
					href: "#",
					title: step.label,
				},
			});
			link.createSpan({
				cls: "editorialist-panel__completion-link-text",
				text: step.label,
			});
			host.bindAction(link, () => {
				void plugin.openEditorialistModal();
			});
			return;
		}

		if (step.action === "start") {
			const link = item.createEl("a", {
				cls: "editorialist-panel__completion-step-link",
				attr: {
					href: "#",
					title: step.label,
				},
			});
			link.createSpan({
				cls: "editorialist-panel__completion-link-text",
				text: step.label,
			});
			host.bindAction(link, () => {
				void plugin.resumeCompletedReviewMode();
			});
			return;
		}

		if (step.action === "clean") {
			const link = item.createEl("a", {
				cls: "editorialist-panel__completion-step-link",
				attr: {
					href: "#",
					title: step.label,
				},
			});
			link.createSpan({
				cls: "editorialist-panel__completion-link-text",
				text: step.label,
			});
			host.bindAction(link, () => {
				void plugin.cleanupCompletedSweepReviewBlocks();
			});
			return;
		}

		if (step.action === "pending" && step.scenePath) {
			const scenePath = step.scenePath;
			const link = item.createEl("a", {
				cls: "editorialist-panel__completion-step-link",
				attr: {
					href: "#",
					title: step.label,
				},
			});
			link.createSpan({
				cls: "editorialist-panel__completion-link-text",
				text: step.label,
			});
			host.bindAction(link, () => {
				void plugin.startPendingEditsReviewForScene(scenePath);
			});
			return;
		}

		item.createSpan({
			cls: "editorialist-panel__completion-step-text",
			text: step.label,
		});
	});

	const closeRow = card.createDiv({ cls: "editorialist-panel__completion-close" });
	const closeLink = closeRow.createEl("a", {
		cls: "editorialist-panel__completion-close-link",
		attr: {
			href: "#",
			title: completedSweep.closeLabel,
		},
	});
	closeLink.createSpan({ text: "→ " });
	closeLink.createSpan({
		cls: "editorialist-panel__completion-link-text",
		text: completedSweep.closeLabel,
	});
	host.bindAction(closeLink, () => {
		void plugin.closeReviewPanel();
	});
}

// ── idle (post-completion) card ──────────────────────────────────────────

export function renderIdleStateCard(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	parent: HTMLElement,
	postCompletionIdle: ReturnType<EditorialistPlugin["getPostCompletionIdleState"]>,
): void {
	if (!postCompletionIdle) {
		return;
	}

	const card = parent.createDiv({
		cls: "editorialist-panel__completion editorialist-panel__completion--neutral",
	});
	const bgIcon = card.createSpan({ cls: "editorialist-panel__completion-bg-icon" });
	setIcon(bgIcon, "pen-tool");

	card.createDiv({
		cls: "editorialist-panel__completion-summary",
		text: "No active review",
	});
	const descriptionEl = card.createDiv({
		cls: "editorialist-panel__completion-description",
	});
	renderIdleStateDescription(descriptionEl, postCompletionIdle.description);

	const steps = card.createDiv({ cls: "editorialist-panel__completion-steps" });

	const importStep = steps.createDiv({
		cls: "editorialist-panel__completion-step editorialist-panel__completion-step--neutral-primary",
	});
	const importBullet = importStep.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
	setIcon(importBullet, "arrow-right");
	const importLink = importStep.createEl("a", {
		cls: "editorialist-panel__completion-step-link",
		attr: {
			href: "#",
			title: "Open Editorialist begin",
		},
	});
	importLink.createSpan({
		cls: "editorialist-panel__completion-link-text",
		text: "Import new revision notes",
	});
	host.bindAction(importLink, () => {
		void plugin.openEditorialistModal();
	});

	const pendingSummary = plugin.getPendingEditsSummary();
	if (pendingSummary && pendingSummary.segmentCount > 0) {
		renderPendingEditsStep(host, plugin, steps, pendingSummary);
	}

	const operationsStep = steps.createDiv({ cls: "editorialist-panel__completion-step" });
	const operationsBullet = operationsStep.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
	setIcon(operationsBullet, "arrow-right");
	operationsStep.createSpan({
		cls: "editorialist-panel__completion-step-text",
		text: "Review revision and contributor details in settings.",
	});
}

// Pure splitter: highlights the literal token "PENDING EDITS" inside the
// description copy with a pill span. Exported for completeness; the only
// call site is renderIdleStateCard above.
export function renderIdleStateDescription(parent: HTMLElement, description: string): void {
	const token = "PENDING EDITS";
	const tokenIndex = description.indexOf(token);
	if (tokenIndex === -1) {
		parent.setText(description);
		return;
	}
	const before = description.slice(0, tokenIndex);
	const after = description.slice(tokenIndex + token.length);
	if (before.length > 0) {
		parent.createSpan({ text: before });
	}
	parent.createSpan({
		cls: "editorialist-panel__completion-description-pill",
		text: token,
	});
	if (after.length > 0) {
		parent.createSpan({ text: after });
	}
}

// ── pending-edits CTA ────────────────────────────────────────────────────

// Slim workspace card surfacing the pending-edits CTA when the user has
// pending edit segments but no active session. Visually mirrors the compact
// onboarding card's pending-edits step verbatim — same icon, link text,
// click action — wrapped in a minimal `__completion --neutral` shell so the
// styling is byte-identical to the chip the compact card shows. Rendered
// from ReviewPanel.render()'s workspace path; the compact card itself still
// includes the same step internally via renderPendingEditsStep below.
export function renderPendingEditsWorkspaceBlock(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	parent: HTMLElement,
	summary: NonNullable<ReturnType<EditorialistPlugin["getPendingEditsSummary"]>>,
): void {
	if (summary.segmentCount <= 0) {
		return;
	}

	const expandable = summary.scenes.length > 0;
	const expanded = expandable && host.getPendingEditsExpanded();
	const section = parent.createDiv({
		cls: `editorialist-panel__pending-edits${expanded ? "" : " is-collapsed"}`,
	});

	const heading = section.createDiv({
		cls: "editorialist-panel__section-header editorialist-panel__pending-edits-header",
	});
	if (expandable) {
		const caret = heading.createSpan({ cls: "editorialist-panel__pending-edits-caret" });
		setIcon(caret, expanded ? "chevron-down" : "chevron-right");
	} else {
		const icon = heading.createSpan({ cls: "editorialist-panel__pending-edits-icon" });
		setIcon(icon, "clipboard-list");
	}
	heading.createDiv({ cls: "editorialist-panel__section-title", text: "Pending edits" });
	const sceneNoun = summary.sceneCount === 1 ? "scene" : "scenes";
	heading.createDiv({
		cls: "editorialist-panel__section-meta",
		text: `${summary.segmentCount} across ${summary.sceneCount} ${sceneNoun}`,
	});
	if (expandable) {
		host.bindAction(heading, () => {
			host.setPendingEditsExpanded(!expanded);
			host.requestRender();
		});
	}

	if (expanded) {
		const list = section.createDiv({ cls: "editorialist-panel__pending-edits-list" });
		for (const scene of summary.scenes) {
			const row = list.createDiv({
				cls: "editorialist-panel__pending-edits-row",
				attr: { title: `Review pending edits in ${scene.title}` },
			});
			const rowHeader = row.createDiv({ cls: "editorialist-panel__pending-edits-row-header" });
			rowHeader.createDiv({
				cls: "editorialist-panel__pending-edits-row-title",
				text: scene.title,
			});
			const targetScenePath = scene.scenePath;
			host.bindAction(row, () => {
				void plugin.startPendingEditsReviewForScene(targetScenePath);
			});
			rowHeader.createSpan({
				cls: "editorialist-panel__pending-edits-row-count",
				text: `${scene.count}`,
			});
			if (scene.firstExcerpt) {
				row.createDiv({
					cls: "editorialist-panel__pending-edits-row-excerpt",
					text: scene.firstExcerpt,
				});
			}
		}
	}

	const steps = section.createDiv({ cls: "editorialist-panel__completion-steps" });
	renderPendingEditsStep(host, plugin, steps, summary);
}

// Shared pending-edits step renderer used by BOTH the compact onboarding
// card and the workspace CTA block. Emits the existing chip-style DOM
// (bullet icon + link + link-text) so the two surfaces stay byte-identical.
export function renderPendingEditsStep(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	steps: HTMLElement,
	summary: NonNullable<ReturnType<EditorialistPlugin["getPendingEditsSummary"]>>,
): void {
	const pendingStep = steps.createDiv({
		cls: "editorialist-panel__completion-step editorialist-panel__completion-step--active",
	});
	const pendingBullet = pendingStep.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
	setIcon(pendingBullet, "clipboard-list");
	const pendingLink = pendingStep.createEl("a", {
		cls: "editorialist-panel__completion-step-link",
		attr: {
			href: "#",
			title: "Start pending-edits review in active book",
		},
	});
	const itemNoun = summary.segmentCount === 1 ? "item" : "items";
	const sceneNoun = summary.sceneCount === 1 ? "scene" : "scenes";
	pendingLink.createSpan({
		cls: "editorialist-panel__completion-link-text",
		text: `Review ${summary.segmentCount} pending edit ${itemNoun} across ${summary.sceneCount} ${sceneNoun}`,
	});
	host.bindAction(pendingLink, () => {
		void plugin.startPendingEditsReview();
	});
}

// ── header launcher chip (workflows disclosure helper) ───────────────────

export function renderHeaderLauncherChip(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	parent: HTMLElement,
): void {
	const chip = parent.createDiv({ cls: "editorialist-panel__launcher-chip" });
	const keys = chip.createSpan({ cls: "editorialist-panel__launcher-chip-keys" });
	keys.createEl("kbd", { text: "⌘" });
	keys.createEl("kbd", { text: "P" });
	const link = chip.createEl("a", {
		cls: "editorialist-panel__launcher-chip-link",
		attr: { href: "#", title: "Open the Editorialist launcher" },
	});
	link.setText("Launcher");
	host.bindAction(link, () => {
		void plugin.openEditorialistModal();
	});
}

// ── continue review card (workspace dominant card) ───────────────────────

export function renderContinueReviewCard(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	parent: HTMLElement,
	launchTarget: NonNullable<ReturnType<EditorialistPlugin["getNextLogicalReviewLaunchTarget"]>>,
	overview: ReturnType<EditorialistPlugin["getReviewStateOverview"]>,
): void {
	const entry = overview
		? [...overview.pending, ...overview.processed].find(
			(candidate) => candidate.notePath === launchTarget.notePath,
		)
		: undefined;

	const card = parent.createDiv({ cls: "editorialist-panel__continue" });

	const eyebrow = card.createDiv({ cls: "editorialist-panel__continue-eyebrow" });
	const eyebrowIcon = eyebrow.createSpan({ cls: "editorialist-panel__continue-eyebrow-icon" });
	setIcon(eyebrowIcon, "pen-tool");
	eyebrow.createSpan({
		cls: "editorialist-panel__continue-eyebrow-text",
		text: launchTarget.intent === "active" ? "Continue review" : "Next in sweep",
	});

	card.createDiv({
		cls: "editorialist-panel__continue-title",
		text: launchTarget.label,
	});

	const metaParts: string[] = [];
	if (entry) {
		if (entry.pendingCount > 0) {
			metaParts.push(`${entry.pendingCount} unresolved`);
		}
		if (entry.deferredCount > 0) {
			metaParts.push(`${entry.deferredCount} deferred`);
		}
		if (entry.processedCount > 0) {
			metaParts.push(`${entry.processedCount} resolved`);
		}
	}
	if (metaParts.length === 0) {
		metaParts.push(`Resume this ${launchTarget.unitLabel}`);
	}
	card.createDiv({
		cls: "editorialist-panel__continue-meta",
		text: metaParts.join(" · "),
	});

	if (entry) {
		card.createDiv({
			cls: "editorialist-panel__continue-timestamp",
			text: `Last opened ${formatRelativeTime(entry.lastUpdated)}`,
		});
	}

	const resumeButton = card.createEl("button", {
		cls: "editorialist-panel__continue-action",
		attr: {
			type: "button",
			title: `Open ${launchTarget.label}`,
		},
	});
	resumeButton.createSpan({
		cls: "editorialist-panel__continue-action-text",
		text: launchTarget.intent === "active" ? "Resume review" : `Start ${launchTarget.unitLabel}`,
	});
	host.bindAction(resumeButton, () => {
		void plugin.startOrResumeReviewForNote(launchTarget.notePath);
	});
}

// ── workflows disclosure (onboarding) ────────────────────────────────────

export function renderWorkflowsDisclosure(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	parent: HTMLElement,
	defaultExpanded: boolean,
): void {
	const expanded = host.getOnboardingExpanded() ?? defaultExpanded;
	const section = parent.createDiv({
		cls: `editorialist-panel__workflows${expanded ? "" : " is-collapsed"}`,
	});

	const heading = section.createDiv({
		cls: "editorialist-panel__section-header editorialist-panel__workflows-header",
	});
	const caret = heading.createSpan({ cls: "editorialist-panel__workflows-caret" });
	setIcon(caret, expanded ? "chevron-down" : "chevron-right");
	heading.createDiv({ cls: "editorialist-panel__section-title", text: "How Editorialist works" });
	host.bindAction(heading, () => {
		host.setOnboardingExpanded(!expanded);
		host.requestRender();
	});
	renderHeaderLauncherChip(host, plugin, heading);

	if (!expanded) {
		return;
	}

	const grid = section.createDiv({ cls: "editorialist-panel__workflow-grid" });
	const workflows: Array<{ icon: string; title: string; body: string }> = [
		{
			icon: "download-cloud",
			title: "Imported review pass",
			body: "Pull in contributor notes from a human reader or AI editor, then accept, reject, or rewrite each suggestion in turn.",
		},
		{
			icon: "clipboard-list",
			title: "Pending edits sweep",
			body: "Walk through free-form revision notes you've left across the active book, scene by scene.",
		},
		{
			icon: "users",
			title: "Contributor directory",
			body: "Star trusted reviewers, resolve aliases on imported batches, and track who shaped each draft.",
		},
	];
	for (const wf of workflows) {
		const card = grid.createDiv({ cls: "editorialist-panel__workflow-card" });
		const iconWrap = card.createSpan({ cls: "editorialist-panel__workflow-icon" });
		setIcon(iconWrap, wf.icon);
		const text = card.createDiv({ cls: "editorialist-panel__workflow-text" });
		text.createDiv({ cls: "editorialist-panel__workflow-title", text: wf.title });
		text.createDiv({ cls: "editorialist-panel__workflow-body", text: wf.body });
	}
}

// ── recent activity block ────────────────────────────────────────────────

export function renderRecentActivityBlock(
	plugin: EditorialistPlugin,
	parent: HTMLElement,
): void {
	const allEntries = plugin.getSweepRegistryEntries();
	if (allEntries.length === 0) {
		return;
	}

	const sortKey = (entry: typeof allEntries[number]): number =>
		entry.cleanedAt ?? entry.importedAt;
	const entries = allEntries
		.slice()
		.sort((left, right) => sortKey(right) - sortKey(left))
		.slice(0, 5);
	const section = parent.createDiv({ cls: "editorialist-panel__history" });
	const heading = section.createDiv({ cls: "editorialist-panel__section-header" });
	heading.createDiv({ cls: "editorialist-panel__section-title", text: "Recent reviews" });
	heading.createDiv({
		cls: "editorialist-panel__section-meta",
		text: `${allEntries.length} total`,
	});

	const scopeFolder = plugin.getActiveBookScopeInfo().sourceFolder;
	const list = section.createDiv({ cls: "editorialist-panel__history-list" });
	for (const entry of entries) {
		const row = list.createDiv({ cls: "editorialist-panel__history-row" });
		const main = row.createDiv({ cls: "editorialist-panel__history-main" });

		const sceneTitle = formatRecentReviewSceneTitle(entry, scopeFolder);
		main.createDiv({
			cls: "editorialist-panel__history-title",
			text: sceneTitle,
		});

		const metaParts: string[] = [];
		if (entry.totalSuggestions > 0) {
			metaParts.push(`${entry.totalSuggestions} ${entry.totalSuggestions === 1 ? "suggestion" : "suggestions"}`);
		}
		const displayTimestamp = entry.cleanedAt ?? entry.importedAt;
		metaParts.push(formatRelativeTime(displayTimestamp));
		main.createDiv({
			cls: "editorialist-panel__history-meta",
			text: metaParts.join(" · "),
		});

		const stats = plugin.getBatchDecisionStats(entry.batchId);
		const statusModifier = entry.status.replace(/_/g, "-");
		const chip = row.createDiv({
			cls: `editorialist-panel__history-stats editorialist-panel__history-stats--${statusModifier}`,
			attr: {
				title: formatStatsTooltip(stats),
			},
		});
		renderStatChip(chip, "check", stats.accepted, "accepted");
		renderStatChip(chip, "x", stats.rejected, "rejected");
		renderStatChip(chip, "pencil-line", stats.rewritten, "rewritten");
		if (stats.deferred > 0) {
			renderStatChip(chip, "circle-pause", stats.deferred, "deferred");
		}

		if (isBatchReadyToClean(entry, stats)) {
			const cleanButton = row.createEl("button", {
				cls: "editorialist-panel__review-state-row-clean",
				attr: { type: "button", "aria-label": "Clean this batch's review block from the scene" },
			});
			const cleanIcon = cleanButton.createSpan({ cls: "editorialist-panel__review-state-row-clean-icon" });
			setIcon(cleanIcon, "eraser");
			cleanButton.createSpan({
				cls: "editorialist-panel__review-state-row-clean-text",
				text: "Clean",
			});
			cleanButton.addEventListener("click", () => {
				void plugin.cleanupReviewBatchById(entry.batchId);
			});
		}
	}
}

// ── contributors block ───────────────────────────────────────────────────

export function renderContributorsBlock(plugin: EditorialistPlugin, parent: HTMLElement): void {
	const allProfiles = plugin.getSortedReviewerProfiles();
	if (allProfiles.length === 0) {
		return;
	}

	const profiles = allProfiles.slice(0, 5);
	const section = parent.createDiv({ cls: "editorialist-panel__contributors" });
	const heading = section.createDiv({ cls: "editorialist-panel__section-header" });
	heading.createDiv({ cls: "editorialist-panel__section-title", text: "Contributors" });
	heading.createDiv({
		cls: "editorialist-panel__section-meta",
		text: `${allProfiles.length} total`,
	});

	const list = section.createDiv({ cls: "editorialist-panel__contributors-list" });
	for (const profile of profiles) {
		const row = list.createDiv({ cls: "editorialist-panel__contributors-row" });

		const aiBrand = profile.kind === "ai"
			? resolveContributorBrand({
				aliases: profile.aliases,
				displayName: profile.displayName,
				model: profile.model,
				provider: profile.provider,
			})
			: null;
		const avatarClasses = ["editorialist-panel__contributors-avatar"];
		if (profile.kind === "ai") {
			avatarClasses.push("is-ai");
		}
		if (profile.isStarred) {
			avatarClasses.push("is-starred");
		}
		if (aiBrand && aiBrand !== "generic") {
			avatarClasses.push(`is-provider-${aiBrand}`);
		}
		const avatar = row.createSpan({ cls: avatarClasses.join(" ") });
		const avatarIcon = avatar.createSpan({ cls: "editorialist-panel__contributors-avatar-icon" });
		if (profile.kind === "ai") {
			if (aiBrand && aiBrand !== "generic") {
				avatarIcon.addClass("is-brand");
				renderContributorBrandMark(avatarIcon, aiBrand);
			} else {
				setIcon(avatarIcon, "cpu");
			}
		} else {
			setIcon(avatarIcon, profile.isStarred ? "user-star" : "user-round");
		}

		const main = row.createDiv({ cls: "editorialist-panel__contributors-main" });
		main.createDiv({ cls: "editorialist-panel__contributors-name", text: profile.displayName });

		const metaParts: string[] = [formatReviewerTypeLabel(profile.reviewerType)];
		if (profile.kind === "ai" && profile.provider) {
			metaParts.push(profile.provider);
		}
		main.createDiv({
			cls: "editorialist-panel__contributors-meta",
			text: metaParts.join(" · "),
		});

		const stat = profile.stats?.totalSuggestions ?? 0;
		if (stat > 0) {
			row.createDiv({
				cls: "editorialist-panel__contributors-stat",
				text: `${stat} ${stat === 1 ? "edit" : "edits"}`,
			});
		}
	}
}

// ── pure helpers ─────────────────────────────────────────────────────────

export function renderStatChip(
	parent: HTMLElement,
	icon: string,
	value: number,
	kind: string,
): void {
	const chip = parent.createSpan({
		cls: `editorialist-panel__history-stat editorialist-panel__history-stat--${kind}${value === 0 ? " is-zero" : ""}`,
	});
	const iconEl = chip.createSpan({ cls: "editorialist-panel__history-stat-icon" });
	setIcon(iconEl, icon);
	chip.createSpan({
		cls: "editorialist-panel__history-stat-value",
		text: `${value}`,
	});
}

export function formatStatsTooltip(stats: {
	accepted: number;
	rejected: number;
	rewritten: number;
	deferred: number;
}): string {
	const parts = [
		`${stats.accepted} accepted`,
		`${stats.rejected} rejected`,
		`${stats.rewritten} rewritten`,
	];
	if (stats.deferred > 0) {
		parts.push(`${stats.deferred} deferred`);
	}
	return parts.join(" · ");
}

// Builds the row title from the scenes a batch touched. One scene shows its
// basename. Two or three list them comma-separated. Four or more truncate
// to the first two plus a "+N more" suffix.
export function formatRecentReviewSceneTitle(
	entry: {
		sceneOrder: readonly string[];
		importedNotePaths: readonly string[];
		activeBookLabel?: string;
	},
	// When set, only scenes inside this folder are named — so a batch that
	// happened to touch a note outside the active book (e.g. a content log)
	// shows just its in-scope scenes. A null scope (no Radial Timeline book and
	// no configured manuscript folder) names every path, preserving prior
	// behavior. If filtering would empty the list, the unfiltered paths are
	// used so a fully out-of-scope batch never renders as a blank title.
	scopeFolder: string | null = null,
): string {
	const allPaths = entry.sceneOrder.length > 0 ? entry.sceneOrder : entry.importedNotePaths;
	const scopedPaths = scopeFolder
		? allPaths.filter((path) => isPathInFolderScope(path, scopeFolder))
		: allPaths;
	const paths = scopedPaths.length > 0 ? scopedPaths : allPaths;
	const titles = paths
		.map((path) => path.split("/").pop()?.replace(/\.md$/i, "")?.trim())
		.filter((title): title is string => Boolean(title));
	if (titles.length === 0) {
		return entry.activeBookLabel?.trim() || "Review pass";
	}
	if (titles.length === 1) {
		return titles[0] ?? "Review pass";
	}
	if (titles.length <= 3) {
		return titles.join(", ");
	}
	const head = titles.slice(0, 2).join(", ");
	return `${head}, +${titles.length - 2} more`;
}

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
	const diff = now - timestamp;
	if (diff < 60_000) return "just now";
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return `${weeks}w ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	const years = Math.floor(days / 365);
	return `${years}y ago`;
}

