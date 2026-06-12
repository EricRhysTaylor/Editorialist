// Lifecycle / map-clearing tests for PendingEditsCoordinator. We mock the
// coordinator's OWN collaborators (PendingEditsCollector, InquiryBriefContext)
// — these are plugin modules, not Obsidian — plus a tiny app stub for the
// two workspace/vault reads. No heavy Obsidian mocking. Focus: session close
// clears state, inquiry maps clear on close AND teardown, late in-flight
// resolution behavior is preserved (NOT cancelled), and summary dedupe.

import { describe, it, expect, vi, beforeEach } from "vitest";

let collectResult: unknown;
const resolveMock = vi.fn();

vi.mock("../core/PendingEditsCollector", () => ({
	collectPendingEdits: vi.fn(async () => collectResult),
	describeCollectFailure: () => "failure",
}));
vi.mock("../core/InquiryBriefContext", () => ({
	InquiryBriefResolver: class {
		resolve = resolveMock;
	},
}));

import { PendingEditsCoordinator, type PendingEditsCoordinatorHost } from "./PendingEditsCoordinator";
import type { PendingEditSegment, PendingEditsSession } from "../models/PendingEditSegment";

function inquirySegment(id: string): PendingEditSegment {
	return {
		id,
		kind: "inquiry",
		scenePath: "Book/s1.md",
		sceneTitle: "S1",
		sceneOrder: 0,
		text: "[[Brief Note]] tighten the opening",
		lines: ["[[Brief Note]] tighten the opening"],
	};
}

function session(segments: PendingEditSegment[]): PendingEditsSession {
	return {
		bookId: "b",
		bookTitle: "B",
		sourceFolder: "Book",
		collectedAt: 0,
		scenes: [
			{ scenePath: "Book/s1.md", sceneTitle: "S1", sceneOrder: 0, rawField: "", segments },
		],
		selectedSegmentId: null,
	};
}

function makeHost() {
	const calls: string[] = [];
	const host: PendingEditsCoordinatorHost = {
		app: {
			vault: { getAbstractFileByPath: () => null },
			workspace: { getActiveFile: () => null, openLinkText: vi.fn() },
		} as never,
		refreshReviewPanel: () => calls.push("refreshPanel"),
		syncActiveEditorDecorations: () => calls.push("syncDecorations"),
		openReviewPanel: async () => { calls.push("openReviewPanel"); },
		closeSettingsModal: () => calls.push("closeSettingsModal"),
	};
	return { host, calls };
}

let deferredResolves: Array<(v: unknown) => void>;

beforeEach(() => {
	deferredResolves = [];
	resolveMock.mockReset();
	resolveMock.mockImplementation(
		() => new Promise((resolve) => deferredResolves.push(resolve)),
	);
	collectResult = { ok: false, reason: "no_active_book" };
});

describe("PendingEditsCoordinator — default access", () => {
	it("exposes null session/summary before any review starts", () => {
		const { host } = makeHost();
		const c = new PendingEditsCoordinator(host);
		expect(c.getPendingEditsSession()).toBeNull();
		expect(c.getPendingEditsSummary()).toBeNull();
		expect(c.hasPendingEditsForScene("x")).toBe(false);
		expect(c.getPendingEditsCountForScene("x")).toBe(0);
		expect(c.getPendingEditsToolbarState()).toBeNull();
	});
});

describe("PendingEditsCoordinator — session lifecycle", () => {
	it("startPendingEditsReview sets the session and opens the panel", async () => {
		const { host, calls } = makeHost();
		collectResult = { ok: true, session: session([inquirySegment("seg1")]) };
		const c = new PendingEditsCoordinator(host);
		c.initialize();
		await c.startPendingEditsReview();
		expect(c.getPendingEditsSession()).not.toBeNull();
		expect(calls).toContain("closeSettingsModal");
		expect(calls).toContain("openReviewPanel");
	});

	it("closePendingEditsReview clears the session and syncs decorations", async () => {
		const { host, calls } = makeHost();
		collectResult = { ok: true, session: session([inquirySegment("seg1")]) };
		const c = new PendingEditsCoordinator(host);
		c.initialize();
		await c.startPendingEditsReview();
		await c.closePendingEditsReview();
		expect(c.getPendingEditsSession()).toBeNull();
		expect(calls).toContain("syncDecorations");
	});
});

describe("PendingEditsCoordinator — inquiry brief map", () => {
	it("fetches lazily then surfaces the resolved brief on the next render", async () => {
		const { host } = makeHost();
		collectResult = { ok: true, session: session([inquirySegment("seg1")]) };
		const c = new PendingEditsCoordinator(host);
		c.initialize();
		await c.startPendingEditsReview();

		// First render: request in-flight, no brief yet.
		expect(c.getPendingEditsToolbarState()?.briefContext).toBeUndefined();
		expect(resolveMock).toHaveBeenCalledTimes(1);

		// Resolve the in-flight request.
		deferredResolves[0]?.({ noteTitle: "Brief", notePath: "Brief.md", summary: "do it" });
		await Promise.resolve();
		await Promise.resolve();

		const state = c.getPendingEditsToolbarState();
		expect(state?.briefContext).toEqual({ noteTitle: "Brief", notePath: "Brief.md", summary: "do it" });
		// Cached — not re-requested.
		expect(resolveMock).toHaveBeenCalledTimes(1);
	});

	it("closePendingEditsReview clears the inquiry maps (a re-opened session re-requests)", async () => {
		const { host } = makeHost();
		collectResult = { ok: true, session: session([inquirySegment("seg1")]) };
		const c = new PendingEditsCoordinator(host);
		c.initialize();

		await c.startPendingEditsReview();
		c.getPendingEditsToolbarState(); // request #1
		deferredResolves[0]?.({ noteTitle: "B", notePath: "B.md", summary: "s" });
		await Promise.resolve();
		await Promise.resolve();
		expect(resolveMock).toHaveBeenCalledTimes(1);

		await c.closePendingEditsReview(); // clears context + inflight maps

		// Re-open the same segment: a cleared context map forces a fresh fetch.
		await c.startPendingEditsReview();
		c.getPendingEditsToolbarState();
		expect(resolveMock).toHaveBeenCalledTimes(2);
	});

	it("clearInquiryMaps (teardown) drops the cached brief", async () => {
		const { host } = makeHost();
		collectResult = { ok: true, session: session([inquirySegment("seg1")]) };
		const c = new PendingEditsCoordinator(host);
		c.initialize();
		await c.startPendingEditsReview();
		c.getPendingEditsToolbarState();
		deferredResolves[0]?.({ noteTitle: "B", notePath: "B.md", summary: "s" });
		await Promise.resolve();
		await Promise.resolve();
		expect(c.getPendingEditsToolbarState()?.briefContext).toBeDefined();

		c.clearInquiryMaps();
		c.getPendingEditsToolbarState(); // cache gone -> re-request
		expect(resolveMock).toHaveBeenCalledTimes(2);
	});

	it("startPendingEditsReview clears stale cached brief context from a prior session (no close in between)", async () => {
		const { host } = makeHost();
		collectResult = { ok: true, session: session([inquirySegment("seg1")]) };
		const c = new PendingEditsCoordinator(host);
		c.initialize();

		// Session 1: resolve and cache the brief.
		await c.startPendingEditsReview();
		c.getPendingEditsToolbarState(); // request #1
		deferredResolves[0]?.({ noteTitle: "Stale", notePath: "Stale.md", summary: "old" });
		await Promise.resolve();
		await Promise.resolve();
		expect(c.getPendingEditsToolbarState()?.briefContext).toEqual({
			noteTitle: "Stale",
			notePath: "Stale.md",
			summary: "old",
		});
		expect(resolveMock).toHaveBeenCalledTimes(1);

		// Session 2 starts without an explicit close — clear-on-start must
		// drop the cached entry so the same segment id refetches.
		await c.startPendingEditsReview();
		c.getPendingEditsToolbarState();
		expect(resolveMock).toHaveBeenCalledTimes(2);
	});

	it("startPendingEditsReview clears stale maps even when the collect fails", async () => {
		const { host } = makeHost();
		collectResult = { ok: true, session: session([inquirySegment("seg1")]) };
		const c = new PendingEditsCoordinator(host);
		c.initialize();

		// Cache something in session 1.
		await c.startPendingEditsReview();
		c.getPendingEditsToolbarState();
		deferredResolves[0]?.({ noteTitle: "B", notePath: "B.md", summary: "s" });
		await Promise.resolve();
		await Promise.resolve();
		expect(resolveMock).toHaveBeenCalledTimes(1);

		// Start a new session that will fail to collect. The clear must still
		// have run — proven by re-starting a successful session and observing
		// a fresh fetch (rather than a cached hit).
		collectResult = { ok: false, reason: "no_active_book" };
		await c.startPendingEditsReview();
		expect(c.getPendingEditsSession()).toBeNull();

		collectResult = { ok: true, session: session([inquirySegment("seg1")]) };
		await c.startPendingEditsReview();
		c.getPendingEditsToolbarState();
		expect(resolveMock).toHaveBeenCalledTimes(2);
	});

	it("PRESERVED BEHAVIOR: a late in-flight resolution from a prior session still writes to the (cleared) map after a new session starts", async () => {
		const { host, calls } = makeHost();
		collectResult = { ok: true, session: session([inquirySegment("seg1")]) };
		const c = new PendingEditsCoordinator(host);
		c.initialize();

		// Session 1: kick off a request and leave it in-flight.
		await c.startPendingEditsReview();
		c.getPendingEditsToolbarState();
		expect(resolveMock).toHaveBeenCalledTimes(1);

		// Session 2 starts before session 1's request resolves. clear-on-start
		// drops the in-flight set entry, but the underlying promise from
		// session 1 is NOT cancelled.
		await c.startPendingEditsReview();
		const syncsBefore = calls.filter((x) => x === "syncDecorations").length;

		// The session-1 request resolves late. Per existing contract, the
		// late callback still writes into the context map and triggers a
		// decoration sync — cancellation was never wired and is out of scope
		// for this pass.
		deferredResolves[0]?.({ noteTitle: "Late", notePath: "Late.md", summary: "x" });
		await Promise.resolve();
		await Promise.resolve();
		const syncsAfter = calls.filter((x) => x === "syncDecorations").length;
		expect(syncsAfter).toBe(syncsBefore + 1);
	});

	it("PRESERVED BEHAVIOR: a request in-flight at close still resolves into the (cleared) map, not cancelled", async () => {
		const { host, calls } = makeHost();
		collectResult = { ok: true, session: session([inquirySegment("seg1")]) };
		const c = new PendingEditsCoordinator(host);
		c.initialize();
		await c.startPendingEditsReview();
		c.getPendingEditsToolbarState(); // request #1 in-flight
		expect(resolveMock).toHaveBeenCalledTimes(1);

		await c.closePendingEditsReview(); // clears maps while request #1 still pending
		const callsBefore = calls.filter((x) => x === "syncDecorations").length;

		// Late resolution must NOT be discarded — it writes back and triggers a
		// decoration sync exactly as before extraction.
		deferredResolves[0]?.({ noteTitle: "Late", notePath: "Late.md", summary: "x" });
		await Promise.resolve();
		await Promise.resolve();
		const callsAfter = calls.filter((x) => x === "syncDecorations").length;
		expect(callsAfter).toBe(callsBefore + 1);
	});
});

describe("PendingEditsCoordinator — scene-scoped review", () => {
	function sceneSegment(scenePath: string, id: string): PendingEditSegment {
		return {
			id,
			kind: "human",
			scenePath,
			sceneTitle: scenePath,
			sceneOrder: 0,
			text: "note",
			lines: ["note"],
		};
	}

	function multiSceneSession(): PendingEditsSession {
		return {
			bookId: "b",
			bookTitle: "B",
			sourceFolder: "Book",
			collectedAt: 0,
			scenes: [
				{ scenePath: "Book/s1.md", sceneTitle: "S1", sceneOrder: 0, rawField: "", segments: [sceneSegment("Book/s1.md", "s1-a")] },
				{ scenePath: "Book/s2.md", sceneTitle: "S2", sceneOrder: 1, rawField: "", segments: [sceneSegment("Book/s2.md", "s2-a"), sceneSegment("Book/s2.md", "s2-b")] },
			],
			selectedSegmentId: null,
		};
	}

	it("narrows the session to the requested scene only", async () => {
		const { host, calls } = makeHost();
		collectResult = { ok: true, session: multiSceneSession() };
		const c = new PendingEditsCoordinator(host);
		c.initialize();

		await c.startPendingEditsReviewForScene("Book/s2.md");

		const active = c.getPendingEditsSession();
		expect(active?.scenes).toHaveLength(1);
		expect(active?.scenes[0]?.scenePath).toBe("Book/s2.md");
		expect(active?.selectedSegmentId).toBe("s2-a");
		expect(calls).toContain("openReviewPanel");
	});

	it("does not open a session when the scene has no pending edits", async () => {
		const { host, calls } = makeHost();
		collectResult = { ok: true, session: multiSceneSession() };
		const c = new PendingEditsCoordinator(host);
		c.initialize();

		await c.startPendingEditsReviewForScene("Book/nonexistent.md");

		expect(c.getPendingEditsSession()).toBeNull();
		expect(calls).not.toContain("openReviewPanel");
	});
});

describe("PendingEditsCoordinator — summary dedupe", () => {
	it("coalesces concurrent non-forced refreshes into one collect", async () => {
		const { host } = makeHost();
		collectResult = {
			ok: true,
			session: session([inquirySegment("seg1")]),
		};
		const collector = await import("../core/PendingEditsCollector");
		const spy = collector.collectPendingEdits as unknown as ReturnType<typeof vi.fn>;
		spy.mockClear();

		const c = new PendingEditsCoordinator(host);
		await Promise.all([
			c.refreshPendingEditsSummary(),
			c.refreshPendingEditsSummary(),
			c.refreshPendingEditsSummary(),
		]);

		expect(spy).toHaveBeenCalledTimes(1);
		const summary = c.getPendingEditsSummary();
		expect(summary?.sceneCount).toBe(1);
		expect(summary?.inquiryCount).toBe(1);
	});
});

describe("PendingEditsCoordinator — summary scenes", () => {
	it("captures per-scene title, count, and a first-item excerpt", async () => {
		const { host } = makeHost();
		collectResult = {
			ok: true,
			session: session([inquirySegment("seg1"), inquirySegment("seg2")]),
		};

		const c = new PendingEditsCoordinator(host);
		await c.refreshPendingEditsSummary({ force: true });

		const summary = c.getPendingEditsSummary();
		expect(summary?.scenes).toHaveLength(1);
		expect(summary?.scenes[0]).toEqual({
			scenePath: "Book/s1.md",
			title: "S1",
			count: 2,
			firstExcerpt: "Brief Note tighten the opening",
		});
	});

	it("renders aliased wiki-links in the excerpt as their alias only", async () => {
		const { host } = makeHost();
		const text = "[[IB-260601-1517|Jun 1]] S9 preamble front-loads a lecture";
		const seg: PendingEditSegment = { ...inquirySegment("seg1"), text, lines: [text] };
		collectResult = { ok: true, session: session([seg]) };

		const c = new PendingEditsCoordinator(host);
		await c.refreshPendingEditsSummary({ force: true });

		expect(c.getPendingEditsSummary()?.scenes[0]?.firstExcerpt).toBe(
			"Jun 1 S9 preamble front-loads a lecture",
		);
	});

	it("collapses whitespace and truncates a long first-item excerpt with an ellipsis", async () => {
		const { host } = makeHost();
		const longText = `${"word ".repeat(60)}tail`;
		const seg: PendingEditSegment = { ...inquirySegment("seg1"), text: longText, lines: [longText] };
		collectResult = { ok: true, session: session([seg]) };

		const c = new PendingEditsCoordinator(host);
		await c.refreshPendingEditsSummary({ force: true });

		const excerpt = c.getPendingEditsSummary()?.scenes[0]?.firstExcerpt ?? "";
		expect(excerpt.endsWith("…")).toBe(true);
		expect(excerpt.length).toBe(120);
		expect(excerpt).not.toContain("  ");
	});
});
