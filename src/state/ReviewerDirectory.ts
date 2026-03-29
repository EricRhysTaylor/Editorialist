import {
	deriveContributorIdentitySeed,
	normalizeContributorValue,
	reviewerTypeToKind,
} from "../core/ContributorIdentity";
import type { ReviewContributor } from "../models/ReviewSuggestion";
import type {
	ParsedReviewerReference,
	ReviewerProfile,
	ReviewerResolutionStatus,
	ReviewerStats,
	ReviewerType,
} from "../models/ReviewerProfile";

export class ReviewerDirectory {
	private profiles: ReviewerProfile[] = [];
	private didChange = false;

	setProfiles(profiles: ReviewerProfile[]): void {
		this.didChange = false;
		this.profiles = profiles.map((profile) => this.normalizeProfile(profile));
	}

	getProfiles(): ReviewerProfile[] {
		return this.profiles.map((profile) => ({
			...profile,
			aliases: [...profile.aliases],
		}));
	}

	consumeDidChange(): boolean {
		const didChange = this.didChange;
		this.didChange = false;
		return didChange;
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
		const seed = deriveContributorIdentitySeed(raw);
		const rawName = raw.rawName?.trim();
		const exactIdMatch = rawName
			? this.findUniqueProfile((profile) => this.normalizeValue(profile.id) === this.normalizeValue(rawName), raw)
			: null;
		if (exactIdMatch) {
			return this.toContributor(this.mergeProfileIdentity(exactIdMatch, seed), raw, "exact");
		}

		const providerModelMatch = seed.kind === "ai" && seed.model
			? this.findUniqueProfile(
					(profile) =>
						profile.kind === "ai" &&
						this.normalizeValue(profile.model ?? profile.displayName) === this.normalizeValue(seed.model as string) &&
						(!seed.provider ||
							!profile.provider ||
							this.normalizeValue(profile.provider) === this.normalizeValue(seed.provider)),
					raw,
				)
			: null;
		if (providerModelMatch) {
			return this.toContributor(this.mergeProfileIdentity(providerModelMatch, seed), raw, "exact");
		}

		const displayMatch = seed.displayName
			? this.findUniqueProfile(
					(profile) => this.normalizeValue(profile.displayName) === this.normalizeValue(seed.displayName),
					raw,
				)
			: null;
		if (displayMatch) {
			return this.toContributor(this.mergeProfileIdentity(displayMatch, seed), raw, "exact");
		}

		const aliasMatch = seed.aliasCandidates.length > 0
			? this.findUniqueProfile(
					(profile) =>
						seed.aliasCandidates.some((candidate) =>
							profile.aliases.some((alias) => this.normalizeValue(alias) === this.normalizeValue(candidate)),
						),
					raw,
				)
			: null;
		if (aliasMatch) {
			return this.toContributor(this.mergeProfileIdentity(aliasMatch, seed), raw, "alias");
		}

		if (seed.displayName.startsWith("Unknown ")) {
			return {
				id: raw.rawName ? `parsed-${this.slugify(raw.rawName)}` : "parsed-unknown-reviewer",
				displayName: seed.displayName,
				kind: seed.kind,
				reviewerType: seed.reviewerType,
				provider: seed.provider,
				model: seed.model,
				reviewerId: undefined,
				resolutionStatus: "unresolved",
				suggestedReviewerIds: [],
				raw,
			};
		}

		const profile = this.createProfileFromSeed(seed);
		return this.toContributor(profile, raw, "new");
	}

	createProfileFromParsedReviewer(raw: ParsedReviewerReference): ReviewerProfile {
		return this.createProfileFromSeed(deriveContributorIdentitySeed(raw));
	}

	mergeProfiles(sourceReviewerId: string, targetReviewerId: string): ReviewerProfile | null {
		if (sourceReviewerId === targetReviewerId) {
			return this.getProfileById(targetReviewerId);
		}

		const source = this.getProfileById(sourceReviewerId);
		const target = this.getProfileById(targetReviewerId);
		if (!source || !target) {
			return null;
		}

		const nextAliases = [...target.aliases];
		for (const alias of [source.displayName, ...source.aliases]) {
			if (!alias.trim()) {
				continue;
			}
			if (this.normalizeValue(alias) === this.normalizeValue(target.displayName)) {
				continue;
			}
			if (nextAliases.some((item) => this.normalizeValue(item) === this.normalizeValue(alias))) {
				continue;
			}
			nextAliases.push(alias);
		}

		target.aliases = nextAliases;
		target.isStarred = Boolean(target.isStarred || source.isStarred);
		target.provider = target.provider ?? source.provider;
		target.model = target.model ?? source.model;
		target.reviewerType = this.chooseReviewerType(target.reviewerType, source.reviewerType);
		target.stats = this.mergeStats(source.stats, target.stats);
		target.updatedAt = Date.now();

		this.profiles = this.profiles.filter((profile) => profile.id !== sourceReviewerId);
		this.didChange = true;
		return target;
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
			this.didChange = true;
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
		this.didChange = true;
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
		this.didChange = true;
		return profile;
	}

	getStats(reviewerId: string): ReviewerStats | null {
		return this.getProfileById(reviewerId)?.stats ?? null;
	}

	ensureProfileFromReassignment(
		displayName: string,
		sourceProfile: ReviewerProfile,
	): ReviewerProfile {
		const normalizedName = displayName.trim();
		if (!normalizedName) {
			return sourceProfile;
		}

		const exactProfile = this.profiles.find(
			(profile) => this.normalizeValue(profile.displayName) === this.normalizeValue(normalizedName),
		);
		if (exactProfile) {
			return exactProfile;
		}

		return this.createProfileFromParsedReviewer({
			rawModel: sourceProfile.kind === "ai" ? normalizedName : undefined,
			rawName: normalizedName,
			rawProvider: sourceProfile.provider,
			rawType: sourceProfile.reviewerType,
		});
	}

	normalizeValue(value: string): string {
		return normalizeContributorValue(value);
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
			reviewerType: profile.reviewerType,
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

	private isCompatibleProfile(profile: ReviewerProfile, raw: ParsedReviewerReference): boolean {
		const seed = deriveContributorIdentitySeed(raw);
		if (profile.kind !== seed.kind) {
			return false;
		}

		if (profile.reviewerType !== seed.reviewerType) {
			const profileKind = reviewerTypeToKind(profile.reviewerType);
			const seedKind = reviewerTypeToKind(seed.reviewerType);
			if (profileKind !== seedKind) {
				return false;
			}
		}

		if (seed.provider && profile.provider && this.normalizeValue(profile.provider) !== this.normalizeValue(seed.provider)) {
			return false;
		}

		if (seed.model && profile.model && this.normalizeValue(profile.model) !== this.normalizeValue(seed.model)) {
			return false;
		}

		return true;
	}

	private createProfileFromSeed(seed: ReturnType<typeof deriveContributorIdentitySeed>): ReviewerProfile {
		const now = Date.now();
		const profile: ReviewerProfile = {
			id: this.createStableId(seed.displayName, seed.kind, seed.provider, seed.model),
			displayName: seed.displayName,
			kind: seed.kind,
			reviewerType: seed.reviewerType,
			aliases: [...seed.aliasCandidates],
			provider: seed.provider,
			model: seed.model,
			isStarred: false,
			stats: this.createEmptyStats(),
			createdAt: now,
			updatedAt: now,
		};

		this.profiles = [...this.profiles, profile];
		this.didChange = true;
		return profile;
	}

	private mergeProfileIdentity(
		profile: ReviewerProfile,
		seed: ReturnType<typeof deriveContributorIdentitySeed>,
	): ReviewerProfile {
		let didUpdate = false;
		const nextAliases = [...profile.aliases];
		for (const alias of seed.aliasCandidates) {
			if (nextAliases.some((item) => this.normalizeValue(item) === this.normalizeValue(alias))) {
				continue;
			}

			nextAliases.push(alias);
			didUpdate = true;
		}

		const nextProvider = profile.provider ?? seed.provider;
		if (nextProvider !== profile.provider) {
			didUpdate = true;
		}

		const nextModel = profile.model ?? seed.model;
		if (nextModel !== profile.model) {
			didUpdate = true;
		}

		const nextReviewerType = this.chooseReviewerType(profile.reviewerType, seed.reviewerType);
		if (nextReviewerType !== profile.reviewerType) {
			didUpdate = true;
		}

		if (!didUpdate) {
			return profile;
		}

		profile.aliases = nextAliases;
		profile.provider = nextProvider;
		profile.model = nextModel;
		profile.reviewerType = nextReviewerType;
		profile.updatedAt = Date.now();
		this.didChange = true;
		return profile;
	}

	private normalizeProfile(profile: ReviewerProfile): ReviewerProfile {
		const seed = deriveContributorIdentitySeed({
			rawModel: profile.kind === "ai" ? profile.model ?? profile.displayName : undefined,
			rawName: profile.displayName,
			rawProvider: profile.provider,
			rawType: (profile as Partial<ReviewerProfile> & { kind?: string; reviewerType?: string }).reviewerType
				?? (profile as Partial<ReviewerProfile> & { kind?: string }).kind,
		});
		const aliases = [...new Set([...(profile.aliases ?? []), ...seed.aliasCandidates])]
			.filter((alias) => this.normalizeValue(alias) !== this.normalizeValue(seed.displayName));
		const normalized: ReviewerProfile = {
			id: profile.id,
			displayName: seed.displayName,
			kind: seed.kind,
			reviewerType: seed.reviewerType,
			aliases,
			provider: seed.provider,
			model: seed.model,
			isStarred: profile.isStarred ?? false,
			stats: {
				...this.createEmptyStats(),
				...profile.stats,
			},
			createdAt: profile.createdAt ?? Date.now(),
			updatedAt: profile.updatedAt ?? profile.createdAt ?? Date.now(),
		};

		if (JSON.stringify(normalized) !== JSON.stringify({
			...profile,
			aliases: [...(profile.aliases ?? [])],
			isStarred: profile.isStarred ?? false,
			stats: {
				...this.createEmptyStats(),
				...profile.stats,
			},
		})) {
			this.didChange = true;
		}

		return normalized;
	}

	private chooseReviewerType(current: ReviewerType, incoming: ReviewerType): ReviewerType {
		if (current === incoming) {
			return current;
		}

		if (current === "editor" && incoming !== "editor") {
			return incoming;
		}

		if (current === "ai-editor" && incoming !== "ai-editor") {
			return incoming;
		}

		return current;
	}

	private mergeStats(source?: ReviewerStats, target?: ReviewerStats): ReviewerStats {
		const sourceStats = {
			...this.createEmptyStats(),
			...source,
		};
		const targetStats = {
			...this.createEmptyStats(),
			...target,
		};

		return {
			totalSuggestions: sourceStats.totalSuggestions + targetStats.totalSuggestions,
			accepted: sourceStats.accepted + targetStats.accepted,
			deferred: sourceStats.deferred + targetStats.deferred,
			rejected: sourceStats.rejected + targetStats.rejected,
			unresolved: sourceStats.unresolved + targetStats.unresolved,
			acceptedEdits: (sourceStats.acceptedEdits ?? 0) + (targetStats.acceptedEdits ?? 0),
			acceptedMoves: (sourceStats.acceptedMoves ?? 0) + (targetStats.acceptedMoves ?? 0),
		};
	}

	private createStableId(displayName: string, kind: ReviewerProfile["kind"], provider?: string, model?: string): string {
		const baseSource = kind === "ai" ? `${provider ?? "ai"}-${model ?? displayName}` : displayName;
		const baseId = `contributor-${kind}-${this.slugify(baseSource)}`;
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
