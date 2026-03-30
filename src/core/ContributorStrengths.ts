import { normalizeContributorValue } from "./ContributorIdentity";
import type { ContributorStrength, ReviewerType } from "../models/ReviewerProfile";

export interface ContributorRoleDefinition {
	label: string;
	value: ReviewerType;
	icon: string;
}

export const CONTRIBUTOR_ROLE_DEFINITIONS: ContributorRoleDefinition[] = [
	{ value: "developmental-editor", label: "Developmental editor", icon: "book-open" },
	{ value: "line-editor", label: "Line editor", icon: "pen-line" },
	{ value: "copy-editor", label: "Copy editor", icon: "spell-check" },
	{ value: "beta-reader", label: "Beta reader", icon: "eye" },
	{ value: "editor", label: "Generalist", icon: "pen-tool" },
	{ value: "ai-editor", label: "AI assistant", icon: "bot" },
] as const;

export interface ContributorStrengthDefinition {
	icon: string;
	label: string;
	value: ContributorStrength;
}

export const CONTRIBUTOR_STRENGTH_DEFINITIONS: ContributorStrengthDefinition[] = [
	{ value: "clarity", label: "Clarity", icon: "align-left" },
	{ value: "tone", label: "Tone", icon: "feather" },
	{ value: "pacing", label: "Pacing", icon: "fast-forward" },
	{ value: "dialogue", label: "Dialogue", icon: "message-circle" },
	{ value: "structure", label: "Structure", icon: "layout" },
	{ value: "character", label: "Character", icon: "user" },
	{ value: "worldbuilding", label: "Worldbuilding", icon: "globe" },
	{ value: "tightening", label: "Tightening", icon: "minimize-2" },
] as const;

const CONTRIBUTOR_STRENGTH_ALIASES: Array<[ContributorStrength, RegExp]> = [
	["clarity", /\bclarity\b|\bclear\b/],
	["tone", /\btone\b|\bvoice\b|\bstyle\b/],
	["pacing", /\bpacing\b|\bpace\b|\brhythm\b/],
	["dialogue", /\bdialogue\b|\bdialog\b|\bconversation\b/],
	["structure", /\bstructure\b|\bstructural\b|\bplot\b|\bstory\b/],
	["character", /\bcharacter\b|\bcharacters\b|\bpov\b/],
	["worldbuilding", /\bworldbuilding\b|\bworld\b|\bsetting\b/],
	["tightening", /\btightening\b|\btighten\b|\bconcise\b|\bcompression\b/],
] as const;

const CONTRIBUTOR_STRENGTH_BY_VALUE = new Map(
	CONTRIBUTOR_STRENGTH_DEFINITIONS.map((definition) => [definition.value, definition]),
);

export function getContributorStrengthDefinition(
	value: ContributorStrength,
): ContributorStrengthDefinition | undefined {
	return CONTRIBUTOR_STRENGTH_BY_VALUE.get(value);
}

export function normalizeContributorStrengths(
	values: Array<string | ContributorStrength>,
): ContributorStrength[] {
	const normalized: ContributorStrength[] = [];
	for (const value of values) {
		const resolved = resolveContributorStrength(value);
		if (!resolved || normalized.includes(resolved)) {
			continue;
		}
		normalized.push(resolved);
	}
	return normalized;
}

export function resolveContributorStrength(
	value: string | ContributorStrength | undefined,
): ContributorStrength | null {
	if (!value) {
		return null;
	}

	const normalized = normalizeContributorValue(value);
	if (!normalized) {
		return null;
	}

	for (const definition of CONTRIBUTOR_STRENGTH_DEFINITIONS) {
		if (definition.value === normalized || normalizeContributorValue(definition.label) === normalized) {
			return definition.value;
		}
	}

	for (const [strength, pattern] of CONTRIBUTOR_STRENGTH_ALIASES) {
		if (pattern.test(normalized)) {
			return strength;
		}
	}

	return null;
}
