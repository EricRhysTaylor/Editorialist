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
	ContributorProfile,
	EditorialistPluginData,
	PersistedReviewDecisionRecord,
	ReviewerSignalRecord,
	SceneReviewRecord,
} from "../models/ContributorProfile";
import type { ReviewSweepRegistryEntry } from "../models/ReviewImport";
import {
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
	warn: (message) => console.warn(message),
};

export function emptyPluginData(): EditorialistPluginData {
	return {
		version: EDITORIALIST_PLUGIN_DATA_VERSION,
		reviewerProfiles: [],
		reviewerSignalIndex: {},
		reviewDecisionIndex: {},
		sceneReviewIndex: {},
		sweepRegistry: {},
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
