import type {
	ContributorKind,
	ContributorProfile,
	ParsedReviewerReference,
	ReviewerType,
} from "../models/ReviewerProfile";
import type { ReviewContributor } from "../models/ReviewSuggestion";

export const HUMAN_REVIEWER_TYPES = [
	"author",
	"beta-reader",
	"editor",
	"developmental-editor",
	"line-editor",
	"copy-editor",
	"publisher-editor",
	"agent",
	"sensitivity-reader",
] as const;

export const AI_REVIEWER_TYPES = [
	"ai-editor",
	"ai-developmental-editor",
	"ai-line-editor",
	"ai-copy-editor",
] as const;

export const REVIEWER_TYPES = [...HUMAN_REVIEWER_TYPES, ...AI_REVIEWER_TYPES] as const;

const REVIEWER_TYPE_ALIASES: Record<string, ReviewerType> = {
	author: "author",
	"beta reader": "beta-reader",
	"beta-reader": "beta-reader",
	betareader: "beta-reader",
	editor: "editor",
	"developmental editor": "developmental-editor",
	"developmental-editor": "developmental-editor",
	developmentaleditor: "developmental-editor",
	"line editor": "line-editor",
	"line-editor": "line-editor",
	lineeditor: "line-editor",
	"copy editor": "copy-editor",
	"copy-editor": "copy-editor",
	copyeditor: "copy-editor",
	"publisher editor": "publisher-editor",
	"publisher-editor": "publisher-editor",
	publishereditor: "publisher-editor",
	agent: "agent",
	"sensitivity reader": "sensitivity-reader",
	"sensitivity-reader": "sensitivity-reader",
	sensitivityreader: "sensitivity-reader",
	ai: "ai-editor",
	"ai editor": "ai-editor",
	"ai-editor": "ai-editor",
	aieditor: "ai-editor",
	"ai developmental editor": "ai-developmental-editor",
	"ai-developmental-editor": "ai-developmental-editor",
	aidevelopmentaleditor: "ai-developmental-editor",
	"ai line editor": "ai-line-editor",
	"ai-line-editor": "ai-line-editor",
	ailineeditor: "ai-line-editor",
	"ai copy editor": "ai-copy-editor",
	"ai-copy-editor": "ai-copy-editor",
	aicopyeditor: "ai-copy-editor",
};

const PROVIDER_ALIASES: Record<string, string> = {
	openai: "OpenAI",
	"open ai": "OpenAI",
	anthropic: "Anthropic",
	google: "Google",
	"google ai": "Google",
	"google deepmind": "Google",
	deepmind: "Google",
	meta: "Meta",
	mistral: "Mistral",
	deepseek: "DeepSeek",
	perplexity: "Perplexity",
	xai: "xAI",
	"x ai": "xAI",
};

interface ContributorIdentitySeed {
	aliasCandidates: string[];
	displayName: string;
	kind: ContributorKind;
	model?: string;
	provider?: string;
	reviewerType: ReviewerType;
}

export function normalizeContributorValue(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[._,;:()[\]{}"'`-]+/g, " ")
		.replace(/\s+/g, " ");
}

export function normalizeProviderName(value?: string): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}

	const normalized = normalizeContributorValue(trimmed);
	return PROVIDER_ALIASES[normalized] ?? trimmed;
}

export function canonicalizeModelName(value?: string): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}

	const collapsed = trimmed.replace(/\s+/g, " ");
	const normalized = normalizeContributorValue(collapsed);

	if (normalized.startsWith("gpt ")) {
		const suffix = collapsed.replace(/^gpt[\s-]*/i, "").trim().replace(/\s+/g, "");
		return suffix ? `GPT-${suffix}` : "GPT";
	}

	if (normalized.startsWith("claude")) {
		return titleCaseWords(collapsed);
	}

	if (normalized.startsWith("gemini")) {
		return titleCaseWords(collapsed);
	}

	return collapsed;
}

export function normalizeReviewerType(
	value?: string,
	fallbackKind: ContributorKind = "human",
): ReviewerType {
	const normalized = value ? normalizeContributorValue(value) : "";
	if (normalized && REVIEWER_TYPE_ALIASES[normalized]) {
		return REVIEWER_TYPE_ALIASES[normalized];
	}

	return fallbackKind === "ai" ? "ai-editor" : "author";
}

export function reviewerTypeToKind(reviewerType: ReviewerType): ContributorKind {
	return reviewerType.startsWith("ai-") ? "ai" : "human";
}

export function inferContributorKind(raw: ParsedReviewerReference): ContributorKind {
	const provider = normalizeProviderName(raw.rawProvider);
	const model = canonicalizeModelName(raw.rawModel);
	const reviewerType = raw.rawType ? normalizeContributorValue(raw.rawType) : "";
	const rawName = canonicalizeModelName(raw.rawName);
	const rawNameKey = rawName ? normalizeContributorValue(rawName) : "";

	if (reviewerType.startsWith("ai")) {
		return "ai";
	}

	if (provider || model) {
		return "ai";
	}

	if (/^(gpt|claude|gemini|chatgpt|grok|llama|mistral|deepseek|o\d)/.test(rawNameKey)) {
		return "ai";
	}

	return "human";
}

export function deriveContributorIdentitySeed(raw: ParsedReviewerReference): ContributorIdentitySeed {
	const kindHint = inferContributorKind(raw);
	const reviewerType = normalizeReviewerType(raw.rawType, kindHint);
	const kind = reviewerTypeToKind(reviewerType);
	const provider = normalizeProviderName(raw.rawProvider);
	const rawName = raw.rawName?.trim();
	const normalizedModel = canonicalizeModelName(raw.rawModel);
	const fallbackModel = kind === "ai" ? canonicalizeModelName(rawName) : undefined;
	const model = kind === "ai" ? normalizedModel ?? fallbackModel : undefined;
	const displayName = kind === "ai"
		? model ?? "Unknown AI contributor"
		: rawName || "Unknown contributor";

	const aliasCandidates = uniqueNonEmpty([
		rawName,
		raw.rawModel?.trim(),
		provider && model ? `${provider} ${model}` : undefined,
	]);

	return {
		aliasCandidates: aliasCandidates.filter(
			(alias) => normalizeContributorValue(alias) !== normalizeContributorValue(displayName),
		),
		displayName,
		kind,
		model,
		provider,
		reviewerType,
	};
}

export function formatReviewerTypeLabel(reviewerType: ReviewerType): string {
	switch (reviewerType) {
		case "author":
			return "Author";
		case "beta-reader":
			return "Beta reader";
		case "editor":
			return "Editor";
		case "developmental-editor":
			return "Developmental editor";
		case "line-editor":
			return "Line editor";
		case "copy-editor":
			return "Copy editor";
		case "publisher-editor":
			return "Publisher editor";
		case "agent":
			return "Agent";
		case "sensitivity-reader":
			return "Sensitivity reader";
		case "ai-editor":
			return "AI editor";
		case "ai-developmental-editor":
			return "AI developmental editor";
		case "ai-line-editor":
			return "AI line editor";
		case "ai-copy-editor":
			return "AI copy editor";
	}
}

export function formatContributorIdentityLabel(
	contributor: Pick<ContributorProfile, "displayName" | "reviewerType"> | Pick<ReviewContributor, "displayName" | "reviewerType">,
): string {
	return `${contributor.displayName} · ${formatReviewerTypeLabel(contributor.reviewerType)}`;
}

export function formatContributorProviderModel(
	contributor: Pick<ContributorProfile, "kind" | "provider" | "model"> | Pick<ReviewContributor, "kind" | "provider" | "model">,
): string | null {
	if (contributor.kind !== "ai") {
		return null;
	}

	const parts = [contributor.provider, contributor.model].filter((value): value is string => Boolean(value?.trim()));
	return parts.length > 0 ? parts.join(" · ") : null;
}

export function getLegacyContributorSignatureKind(
	contributor:
		| Pick<ContributorProfile, "kind" | "reviewerType">
		| Pick<ReviewContributor, "kind" | "reviewerType">,
): "author" | "editor" | "beta-reader" | "ai" {
	if (contributor.kind === "ai") {
		return "ai";
	}

	if (contributor.reviewerType === "author") {
		return "author";
	}

	if (contributor.reviewerType === "beta-reader") {
		return "beta-reader";
	}

	return "editor";
}

function titleCaseWords(value: string): string {
	return value
		.split(" ")
		.map((part) => {
			if (!part) {
				return part;
			}

			if (/^[0-9.]+$/.test(part)) {
				return part;
			}

			return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
		})
		.join(" ");
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
	const unique: string[] = [];
	for (const value of values) {
		const trimmed = value?.trim();
		if (!trimmed) {
			continue;
		}

		if (unique.some((item) => normalizeContributorValue(item) === normalizeContributorValue(trimmed))) {
			continue;
		}

		unique.push(trimmed);
	}

	return unique;
}
