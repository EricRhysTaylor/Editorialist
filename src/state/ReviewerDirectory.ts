import type { ReviewContributor, ReviewContributorKind } from "../models/ReviewSuggestion";
import type {
	ParsedReviewerReference,
	ReviewerProfile,
	ReviewerResolutionStatus,
	ReviewerStats,
} from "../models/ReviewerProfile";

export class ReviewerDirectory {
	private profiles: ReviewerProfile[] = [];

	setProfiles(profiles: ReviewerProfile[]): void {
		this.profiles = profiles.map((profile) => ({
			...profile,
			aliases: [...profile.aliases],
			isStarred: profile.isStarred ?? false,
			stats: {
				...this.createEmptyStats(),
				...profile.stats,
			},
		}));
	}

	getProfiles(): ReviewerProfile[] {
		return this.profiles.map((profile) => ({
			...profile,
			aliases: [...profile.aliases],
		}));
	}

	getProfileById(id: string): ReviewerProfile | null {
		return this.profiles.find((profile) => profile.id === id) ?? null;
	}

	getSortedProfiles(): ReviewerProfile[] {
		return this.getProfiles().sort((left, right) => {
			if (Boolean(left.isStarred) !== Boolean(right.isStarred)) {
				return left.isStarred ? -1 : 1;
			}

			return left.displayName.localeCompare(right.displayName);
		});
	}

	resolveContributor(raw: ParsedReviewerReference): ReviewContributor {
		const parsedKind = this.parseReviewerKind(raw.rawType);
		const fallbackName = raw.rawName?.trim() || "Unknown reviewer";
		const rawName = raw.rawName?.trim();
		const exactIdMatch = rawName
			? this.findUniqueProfile((profile) => this.normalizeValue(profile.id) === this.normalizeValue(rawName), raw)
			: null;
		if (exactIdMatch) {
			return this.toContributor(exactIdMatch, raw, "exact");
		}

		const displayMatch = rawName
			? this.findUniqueProfile(
					(profile) => this.normalizeValue(profile.displayName) === this.normalizeValue(rawName),
					raw,
				)
			: null;
		if (displayMatch) {
			return this.toContributor(displayMatch, raw, "exact");
		}

		const aliasMatch = rawName
			? this.findUniqueProfile(
					(profile) => profile.aliases.some((alias) => this.normalizeValue(alias) === this.normalizeValue(rawName)),
					raw,
				)
			: null;
		if (aliasMatch) {
			return this.toContributor(aliasMatch, raw, "alias");
		}

		const suggestedProfiles = this.findSuggestedProfiles(raw);
		const resolutionStatus: ReviewerResolutionStatus = raw.rawName
			? suggestedProfiles.length > 0
				? "suggested"
				: "new"
			: "unresolved";

		return {
			id: raw.rawName ? `parsed-${this.slugify(raw.rawName)}` : "parsed-unknown-reviewer",
			displayName: fallbackName,
			kind: parsedKind,
			provider: raw.rawProvider?.trim() || undefined,
			model: raw.rawModel?.trim() || undefined,
			reviewerId: undefined,
			resolutionStatus,
			suggestedReviewerIds: suggestedProfiles.map((profile) => profile.id),
			raw,
		};
	}

	createProfileFromParsedReviewer(raw: ParsedReviewerReference): ReviewerProfile {
		const now = Date.now();
		const displayName = raw.rawName?.trim() || "Unknown reviewer";
		const profile: ReviewerProfile = {
			id: this.createStableId(displayName),
			displayName,
			shortLabel: undefined,
			kind: this.parseReviewerKind(raw.rawType),
			aliases: [],
			provider: raw.rawProvider?.trim() || undefined,
			model: raw.rawModel?.trim() || undefined,
			isStarred: false,
			stats: this.createEmptyStats(),
			createdAt: now,
			updatedAt: now,
		};

		this.profiles = [...this.profiles, profile];
		return profile;
	}

	addAlias(reviewerId: string, alias: string): ReviewerProfile | null {
		const normalizedAlias = alias.trim();
		if (!normalizedAlias) {
			return null;
		}

		const profile = this.getProfileById(reviewerId);
		if (!profile) {
			return null;
		}

		const aliasExists = profile.aliases.some((item) => this.normalizeValue(item) === this.normalizeValue(normalizedAlias));
		if (!aliasExists) {
			profile.aliases = [...profile.aliases, normalizedAlias];
		}
		profile.updatedAt = Date.now();
		return profile;
	}

	toggleStar(reviewerId: string): ReviewerProfile | null {
		const profile = this.getProfileById(reviewerId);
		if (!profile) {
			return null;
		}

		profile.isStarred = !profile.isStarred;
		profile.updatedAt = Date.now();
		return profile;
	}

	setStats(reviewerId: string, stats: ReviewerStats): ReviewerProfile | null {
		const profile = this.getProfileById(reviewerId);
		if (!profile) {
			return null;
		}

		profile.stats = {
			...this.createEmptyStats(),
			...stats,
		};
		profile.updatedAt = Date.now();
		return profile;
	}

	getStats(reviewerId: string): ReviewerStats | null {
		return this.getProfileById(reviewerId)?.stats ?? null;
	}

	normalizeValue(value: string): string {
		return value
			.toLowerCase()
			.trim()
			.replace(/[._,;:()[\]{}"'`-]+/g, " ")
			.replace(/\s+/g, " ");
	}

	private toContributor(
		profile: ReviewerProfile,
		raw: ParsedReviewerReference,
		resolutionStatus: ReviewerResolutionStatus,
	): ReviewContributor {
		return {
			id: profile.id,
			displayName: profile.displayName,
			kind: profile.kind,
			provider: profile.provider,
			model: profile.model,
			reviewerId: profile.id,
			resolutionStatus,
			suggestedReviewerIds: [],
			raw,
		};
	}

	private findUniqueProfile(
		predicate: (profile: ReviewerProfile) => boolean,
		raw: ParsedReviewerReference,
	): ReviewerProfile | null {
		const matches = this.profiles.filter((profile) => predicate(profile) && this.isCompatibleProfile(profile, raw));
		return matches.length === 1 ? matches[0] ?? null : null;
	}

	private findSuggestedProfiles(raw: ParsedReviewerReference): ReviewerProfile[] {
		const rawName = raw.rawName?.trim();
		if (!rawName) {
			return [];
		}

		const normalizedRawName = this.normalizeValue(rawName);
		const rawTokens = normalizedRawName.split(" ").filter(Boolean);
		if (rawTokens.length === 0) {
			return [];
		}

		return this.profiles.filter((profile) => {
			if (!this.isCompatibleProfile(profile, raw)) {
				return false;
			}

			const normalizedDisplayName = this.normalizeValue(profile.displayName);
			const displayTokens = normalizedDisplayName.split(" ").filter(Boolean);
			const firstTokenMatches = displayTokens[0] === rawTokens[0];
			const containsRaw = normalizedDisplayName.includes(normalizedRawName) || normalizedRawName.includes(normalizedDisplayName);
			return firstTokenMatches || containsRaw;
		});
	}

	private isCompatibleProfile(profile: ReviewerProfile, raw: ParsedReviewerReference): boolean {
		const rawKind = this.parseReviewerKind(raw.rawType);
		if (raw.rawType && profile.kind !== rawKind) {
			return false;
		}

		if (raw.rawProvider && profile.provider && this.normalizeValue(profile.provider) !== this.normalizeValue(raw.rawProvider)) {
			return false;
		}

		if (raw.rawModel && profile.model && this.normalizeValue(profile.model) !== this.normalizeValue(raw.rawModel)) {
			return false;
		}

		return true;
	}

	private parseReviewerKind(value?: string): ReviewContributorKind {
		const normalized = value?.trim().toLowerCase();
		if (normalized === "editor" || normalized === "ai" || normalized === "author") {
			return normalized;
		}

		if (normalized === "betareader" || normalized === "beta-reader" || normalized === "beta reader") {
			return "beta-reader";
		}

		return "author";
	}

	private createStableId(displayName: string): string {
		const baseId = `reviewer-${this.slugify(displayName)}`;
		if (!this.profiles.some((profile) => profile.id === baseId)) {
			return baseId;
		}

		let counter = 2;
		while (this.profiles.some((profile) => profile.id === `${baseId}-${counter}`)) {
			counter += 1;
		}

		return `${baseId}-${counter}`;
	}

	private slugify(value: string): string {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "unknown";
	}

	private createEmptyStats(): ReviewerStats {
		return {
			totalSuggestions: 0,
			accepted: 0,
			deferred: 0,
			rejected: 0,
			unresolved: 0,
			acceptedEdits: 0,
			acceptedMoves: 0,
		};
	}
}
