import { describe, expect, it } from "vitest";
import {
	EDITORIALIST_PLUGIN_DATA_VERSION,
	emptyPluginData,
	migratePluginData,
	type MigrationLogger,
} from "./PluginDataMigration";

function makeRecorder(): MigrationLogger & { warnings: string[] } {
	const warnings: string[] = [];
	return {
		warnings,
		warn(message) {
			warnings.push(message);
		},
	};
}

describe("migratePluginData", () => {
	it("returns empty plugin data stamped with the current version for null", () => {
		const logger = makeRecorder();
		const out = migratePluginData(null, logger);
		expect(out).toEqual(emptyPluginData());
		expect(out.version).toBe(EDITORIALIST_PLUGIN_DATA_VERSION);
		expect(logger.warnings).toHaveLength(0);
	});

	it("returns empty plugin data for undefined", () => {
		expect(migratePluginData(undefined, makeRecorder())).toEqual(emptyPluginData());
	});

	it("returns empty plugin data for a primitive", () => {
		expect(migratePluginData(42, makeRecorder())).toEqual(emptyPluginData());
		expect(migratePluginData("garbage", makeRecorder())).toEqual(emptyPluginData());
		expect(migratePluginData(true, makeRecorder())).toEqual(emptyPluginData());
	});

	it("returns empty plugin data for an array (not a plain object)", () => {
		expect(migratePluginData([1, 2, 3], makeRecorder())).toEqual(emptyPluginData());
	});

	it("stamps the current version when the saved data has no version field", () => {
		const logger = makeRecorder();
		const out = migratePluginData(
			{
				reviewerProfiles: [],
				reviewerSignalIndex: {},
				reviewDecisionIndex: {},
				sceneReviewIndex: {},
				sweepRegistry: {},
			},
			logger,
		);
		expect(out.version).toBe(EDITORIALIST_PLUGIN_DATA_VERSION);
		expect(logger.warnings).toHaveLength(0);
	});

	it("treats string / NaN / non-integer / negative versions as missing", () => {
		const logger = makeRecorder();
		for (const bogus of ["1", "v1", Number.NaN, Number.POSITIVE_INFINITY, 1.5, 0, -3]) {
			const out = migratePluginData({ version: bogus }, logger);
			expect(out.version).toBe(EDITORIALIST_PLUGIN_DATA_VERSION);
		}
		// None of these are "future version" — they are unreadable, so no warning.
		expect(logger.warnings).toHaveLength(0);
	});

	it("passes through current-version data after normalization", () => {
		const out = migratePluginData(
			{
				version: EDITORIALIST_PLUGIN_DATA_VERSION,
				reviewerProfiles: [
					{
						id: "r1",
						displayName: "Alex",
						kind: "human",
						reviewerType: "editor",
						aliases: [],
						createdAt: 1,
						updatedAt: 2,
					},
				],
			},
			makeRecorder(),
		);
		expect(out.version).toBe(EDITORIALIST_PLUGIN_DATA_VERSION);
		expect(out.reviewerProfiles).toHaveLength(1);
		expect(out.reviewerProfiles[0]?.id).toBe("r1");
	});

	it("warns and best-effort normalizes when the version is in the future", () => {
		const logger = makeRecorder();
		const out = migratePluginData(
			{
				version: EDITORIALIST_PLUGIN_DATA_VERSION + 7,
				reviewerProfiles: [
					{
						id: "r1",
						displayName: "Alex",
						kind: "human",
						reviewerType: "editor",
						aliases: [],
						createdAt: 1,
						updatedAt: 2,
					},
				],
				reviewerSignalIndex: { s1: { key: "s1", reviewerId: "r1", status: "accepted", operation: "edit" } },
			},
			logger,
		);
		expect(out.version).toBe(EDITORIALIST_PLUGIN_DATA_VERSION);
		expect(out.reviewerProfiles).toHaveLength(1);
		expect(out.reviewerSignalIndex.s1?.reviewerId).toBe("r1");
		expect(logger.warnings).toHaveLength(1);
		expect(logger.warnings[0]).toMatch(/version/i);
		expect(logger.warnings[0]).toContain(String(EDITORIALIST_PLUGIN_DATA_VERSION + 7));
	});

	it("preserves reviewerProfiles array and ignores a non-array reviewerProfiles field", () => {
		const out = migratePluginData(
			{
				version: EDITORIALIST_PLUGIN_DATA_VERSION,
				reviewerProfiles: { not: "an array" },
			},
			makeRecorder(),
		);
		expect(out.reviewerProfiles).toEqual([]);
	});

	it("ignores non-object sub-shapes (no throw, empty indices)", () => {
		const out = migratePluginData(
			{
				version: EDITORIALIST_PLUGIN_DATA_VERSION,
				reviewerSignalIndex: "nope",
				reviewDecisionIndex: 7,
				sceneReviewIndex: null,
				sweepRegistry: [1, 2],
			},
			makeRecorder(),
		);
		expect(out.reviewerSignalIndex).toEqual({});
		expect(out.reviewDecisionIndex).toEqual({});
		expect(out.sceneReviewIndex).toEqual({});
		expect(out.sweepRegistry).toEqual({});
	});

	it("delegates legacy enum coercion to the normalizers (status 'later' -> 'deferred')", () => {
		const out = migratePluginData(
			{
				// No version field: legacy on-disk shape from before this module shipped.
				reviewDecisionIndex: {
					k1: { status: "later", updatedAt: 9 },
				},
				sweepRegistry: {
					b1: { status: "cleaned_up", batchId: "b1" },
				},
			},
			makeRecorder(),
		);
		expect(out.reviewDecisionIndex.k1?.status).toBe("deferred");
		expect(out.sweepRegistry.b1?.status).toBe("cleaned");
	});

	it("output is structurally a full EditorialistPluginData", () => {
		const out = migratePluginData({}, makeRecorder());
		expect(Object.keys(out).sort()).toEqual(
			[
				"authorQueryDecisions",
				"reviewDecisionIndex",
				"reviewerProfiles",
				"reviewerSignalIndex",
				"sceneReviewIndex",
				"settings",
				"sweepRegistry",
				"version",
			].sort(),
		);
	});

	it("round-trips: migrating the output of migratePluginData is a fixed point", () => {
		const first = migratePluginData(
			{
				reviewDecisionIndex: { k1: { status: "later", updatedAt: 5 } },
			},
			makeRecorder(),
		);
		const second = migratePluginData(first, makeRecorder());
		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
	});

	it("defaults settings to empty folder overrides + default effort when absent", () => {
		const out = migratePluginData({}, makeRecorder());
		expect(out.settings).toEqual({
			cutFolderOverride: "",
			bookFolderOverride: "",
			effort: {
				wordsPerNewScene: 1500,
				draftRateWordsPerHour: 750,
				minutesPerDirective: 12,
				dailyWritingHours: 2,
			},
		});
	});

	it("clamps a garbage effort value to its default", () => {
		const out = migratePluginData(
			{ settings: { effort: { draftRateWordsPerHour: -10, wordsPerNewScene: 2000 } } },
			makeRecorder(),
		);
		expect(out.settings.effort.draftRateWordsPerHour).toBe(750);
		expect(out.settings.effort.wordsPerNewScene).toBe(2000);
	});

	it("preserves a valid cut folder override and survives round-trip", () => {
		const out = migratePluginData(
			{ settings: { cutFolderOverride: "Manuscript/Cuts" } },
			makeRecorder(),
		);
		expect(out.settings.cutFolderOverride).toBe("Manuscript/Cuts");
		const round = migratePluginData(out, makeRecorder());
		expect(round.settings.cutFolderOverride).toBe("Manuscript/Cuts");
	});

	it("preserves a valid book folder override and survives round-trip", () => {
		const out = migratePluginData(
			{ settings: { bookFolderOverride: "Manuscript/Book One" } },
			makeRecorder(),
		);
		expect(out.settings.bookFolderOverride).toBe("Manuscript/Book One");
		expect(out.settings.cutFolderOverride).toBe("");
		const round = migratePluginData(out, makeRecorder());
		expect(round.settings.bookFolderOverride).toBe("Manuscript/Book One");
	});

	it("falls back to defaults for a malformed settings object", () => {
		const defaults = {
			cutFolderOverride: "",
			bookFolderOverride: "",
			effort: {
				wordsPerNewScene: 1500,
				draftRateWordsPerHour: 750,
				minutesPerDirective: 12,
				dailyWritingHours: 2,
			},
		};
		expect(migratePluginData({ settings: 42 }, makeRecorder()).settings).toEqual(defaults);
		expect(migratePluginData({ settings: [1, 2] }, makeRecorder()).settings).toEqual(defaults);
		expect(
			migratePluginData(
				{ settings: { cutFolderOverride: 7, bookFolderOverride: 9 } },
				makeRecorder(),
			).settings,
		).toEqual(defaults);
	});
});

describe("emptyPluginData", () => {
	it("returns a fresh object each call (no shared mutable state)", () => {
		const a = emptyPluginData();
		const b = emptyPluginData();
		expect(a).not.toBe(b);
		expect(a.sweepRegistry).not.toBe(b.sweepRegistry);
	});

	it("is stamped with the current version", () => {
		expect(emptyPluginData().version).toBe(EDITORIALIST_PLUGIN_DATA_VERSION);
	});
});
