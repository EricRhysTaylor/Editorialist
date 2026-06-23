// Versioning + migration shim for Editorialist persisted plugin data.
//
// Today the on-disk shape predates an explicit schema version. This module
// introduces EDITORIALIST_PLUGIN_DATA_VERSION = 1, the read-side migrator,
// and the empty-data factory. Sub-shape normalization (indices, sweep
// registry, legacy enum aliases) is delegated to the existing pure
// normalize* functions so behavior stays byte-identical with prior loads.
//
// The migrator is intentionally tolerant of every input shape — null,
// garbage, partial, current, and future on-disk objects all yield a
// fully-formed EditorialistPluginData stamped with the current version.
// Future-version inputs are explicitly logged (not silently downgraded
// without notice). When a real schema change lands, add a numbered branch
// here and bump EDITORIALIST_PLUGIN_DATA_VERSION; the normalize* layer
// continues to handle within-version field-level legacy values.

import type {
	AuthorQueryDecisionRecord,
	ContributorProfile,
	EditorialistPluginData,
	EditorialistSettings,
	PersistedReviewDecisionRecord,
	ReviewerSignalRecord,
	SceneReviewRecord,
} from "../models/ContributorProfile";
import type { ReviewSweepRegistryEntry } from "../models/ReviewImport";
import {
	normalizeAuthorQueryDecisions,
	normalizeReviewDecisionIndex,
	normalizeReviewerSignalIndex,
	normalizeSceneReviewIndex,
	normalizeSweepRegistry,
} from "./registry/ReviewRegistryNormalization";

export const EDITORIALIST_PLUGIN_DATA_VERSION = 1 as const;

export interface MigrationLogger {
	warn(message: string): void;
}

const defaultLogger: MigrationLogger = {
	// Intentional: this is the migrator's diagnostic surface for unknown
	// future schema versions. Loud, not silent.
	warn: (message) => console.warn(message),
};

export function defaultEditorialistSettings(): EditorialistSettings {
	return {
		cutFolderOverride: "",
		bookFolderOverride: "",
		effort: {
			wordsPerNewScene: 1500,
			draftRateWordsPerHour: 750,
			minutesPerDirective: 12,
			dailyWritingHours: 2,
		},
	};
}

// Clamp a persisted numeric setting to a positive value, falling back to the
// default when missing or garbage.
function positiveNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

// Tolerant settings normalizer: a non-string or garbage field collapses to the
// empty-string "unset" default so a malformed data.json never throws
// downstream.
export function normalizeEditorialistSettings(raw: unknown): EditorialistSettings {
	const defaults = defaultEditorialistSettings();
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return defaults;
	}

	const candidate = raw as Record<string, unknown>;
	const cutFolderOverride =
		typeof candidate.cutFolderOverride === "string" ? candidate.cutFolderOverride : defaults.cutFolderOverride;
	const bookFolderOverride =
		typeof candidate.bookFolderOverride === "string" ? candidate.bookFolderOverride : defaults.bookFolderOverride;

	const rawEffort =
		typeof candidate.effort === "object" && candidate.effort !== null
			? (candidate.effort as Record<string, unknown>)
			: {};
	const effort = {
		wordsPerNewScene: positiveNumber(rawEffort.wordsPerNewScene, defaults.effort.wordsPerNewScene),
		draftRateWordsPerHour: positiveNumber(rawEffort.draftRateWordsPerHour, defaults.effort.draftRateWordsPerHour),
		minutesPerDirective: positiveNumber(rawEffort.minutesPerDirective, defaults.effort.minutesPerDirective),
		dailyWritingHours: positiveNumber(rawEffort.dailyWritingHours, defaults.effort.dailyWritingHours),
	};

	return {
		cutFolderOverride,
		bookFolderOverride,
		effort,
	};
}

export function emptyPluginData(): EditorialistPluginData {
	return {
		version: EDITORIALIST_PLUGIN_DATA_VERSION,
		reviewerProfiles: [],
		reviewerSignalIndex: {},
		reviewDecisionIndex: {},
		authorQueryDecisions: {},
		sceneReviewIndex: {},
		sweepRegistry: {},
		settings: defaultEditorialistSettings(),
	};
}

export function migratePluginData(
	raw: unknown,
	logger: MigrationLogger = defaultLogger,
): EditorialistPluginData {
	if (!isPlainObject(raw)) {
		return emptyPluginData();
	}

	const detectedVersion = readSchemaVersion(raw.version);

	// Explicit handling for unknown future versions: best-effort normalize so
	// a forward-then-back downgrade does not destroy data on disk, but warn
	// loudly so a developer or user notices the mismatch. The next save will
	// stamp the current version label.
	if (detectedVersion !== null && detectedVersion > EDITORIALIST_PLUGIN_DATA_VERSION) {
		logger.warn(
			`Editorialist persisted data version ${detectedVersion} is newer than the supported version ${EDITORIALIST_PLUGIN_DATA_VERSION}. ` +
				`Loading with best-effort normalization; the next save will rewrite the on-disk version to ${EDITORIALIST_PLUGIN_DATA_VERSION}.`,
		);
	}

	// Today there is only v1. Missing/malformed/older/current/future all
	// route through the same normalization. When a real schema change ships,
	// add the branch here:
	//
	//   if (detectedVersion === null || detectedVersion < 2) {
	//       raw = migrateV1ToV2(raw);
	//   }
	//
	// keeping each step pure and idempotent.

	return normalizeIntoCurrent(raw);
}

function normalizeIntoCurrent(raw: Record<string, unknown>): EditorialistPluginData {
	const reviewerProfiles = Array.isArray(raw.reviewerProfiles)
		? (raw.reviewerProfiles as ContributorProfile[])
		: [];

	return {
		version: EDITORIALIST_PLUGIN_DATA_VERSION,
		reviewerProfiles,
		reviewerSignalIndex: normalizeReviewerSignalIndex(
			pickObject(raw.reviewerSignalIndex) as Record<string, ReviewerSignalRecord> | undefined,
		),
		reviewDecisionIndex: normalizeReviewDecisionIndex(
			pickObject(raw.reviewDecisionIndex) as
				| Partial<Record<string, Partial<PersistedReviewDecisionRecord> & { status?: PersistedReviewDecisionRecord["status"] | "later" }>>
				| undefined,
		),
		authorQueryDecisions: normalizeAuthorQueryDecisions(
			pickObject(raw.authorQueryDecisions) as
				| Partial<Record<string, Partial<AuthorQueryDecisionRecord>>>
				| undefined,
		),
		sceneReviewIndex: normalizeSceneReviewIndex(
			pickObject(raw.sceneReviewIndex) as
				| Partial<Record<string, Partial<SceneReviewRecord> & { resolvedCount?: number; status?: SceneReviewRecord["status"] | "not_started" }>>
				| undefined,
		),
		sweepRegistry: normalizeSweepRegistry(
			pickObject(raw.sweepRegistry) as
				| Partial<Record<string, Partial<ReviewSweepRegistryEntry> & { status?: ReviewSweepRegistryEntry["status"] | "cleaned_up" | "imported" }>>
				| undefined,
		),
		settings: normalizeEditorialistSettings(raw.settings),
	};
}

function readSchemaVersion(value: unknown): number | null {
	if (typeof value !== "number") {
		return null;
	}
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
		return null;
	}
	return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickObject(value: unknown): Record<string, unknown> | undefined {
	return isPlainObject(value) ? value : undefined;
}
