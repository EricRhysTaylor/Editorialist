# Codebase Health Report — 2026-06-23

**Cadence:** Weekly  
**Audited by:** Codex  
**Branch / commit:** `master` @ `9c6dd67`  
**Build status at audit time:** `pass` (`npm run typecheck`, `npm run check`, `npm test`, `npm run css-drift -- --maintenance`, `node esbuild.config.mjs production`)  
**Previous report:** `reports/2026-06-08-codebase-health.md`

---

## Executive Summary

The 1.0.8 codebase is mechanically healthy: typecheck, lint, CSS audit, QA audit, Obsidian compliance, CSS drift, tests, and a side-effect-free production build all pass. Since the prior report, the test suite grew from 570 to 644 tests and the `.DS_Store` issue is resolved. The main watch item remains file and function size: `src/main.ts` and the primary UI files absorbed another release of feature work.

---

## Top Metrics

| Metric | This cycle | Prev cycle | Delta |
|---|---:|---:|---:|
| Largest TS file (lines) | `src/main.ts` — 3,577 | `src/main.ts` — 3,104 | +473 |
| `src/main.ts` (lines) | 3,577 | 3,104 | +473 |
| `styles.css` (lines) | 5,713 | 5,524 | +189 |
| Files > 600 lines | 11 | 11 | 0 |
| Functions > 80 lines | 54 | 48 | +6 |
| Dead exports (count) | 18 heuristic candidates, 0 confirmed | 6 heuristic candidates, 0 confirmed | +12 heuristic |
| Unused CSS classes (count) | 100 heuristic candidates, 0 confirmed | 93 heuristic candidates, 0 confirmed | +7 heuristic |
| `// TODO` / `// FIXME` count | 2 product-code TODOs | 2 product-code TODOs | 0 |
| `// SAFE:` exceptions (count) | 9 | 12 | -3 |
| `main.js` size (KB) | 421 KB | 379 KB | +42 KB |
| `styles.css` size (KB) | 149 KB | 143 KB | +6 KB |

---

## Findings

### CH-2026-06-23-#1 — Large composition files remain the main cleanup pressure

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** New panel and workflow changes will continue to be slower to review and easier to regress if they keep landing in the same large files.
- **Effort:** 1-2 days, paired with the next related feature pass
- **Evidence:** `src/main.ts` is 3,577 lines; `src/ui/ReviewPanel.ts` is 1,876; `src/ui/EditorialistSettingTab.ts` is 1,725; `src/ui/EditorialistModal.ts` is 1,239; `src/ui/Toolbar.ts` is 819.
- **Suggested next action:** Do not block 1.0.8. For the next panel/settings change, extract one complete responsibility rather than moving code for its own sake.

### CH-2026-06-23-#2 — Long render/test bodies are increasing but still localized

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** Medium
- **Risk:** Long render functions make UI changes more fragile; long tests hide the scenario setup from the assertion.
- **Effort:** hours to days, opportunistic
- **Evidence:** `src/ui/Toolbar.ts:119-548` is 430 lines; `src/ui/ReviewPanel.ts:105-397` is 293 lines; `src/ui/EditorialistSettingTab.ts:816-984` is 169 lines; `src/core/ImportEngine.ts:222-365` is 144 lines.
- **Suggested next action:** When touching each surface, pull out named render subparts or setup helpers that reduce branch count and make tests read at the scenario level.

### CH-2026-06-23-#3 — Optional Obsidian lint wrapper is not a dependable local signal

- **Status:** Confirmed
- **Category:** stabilization
- **Severity:** YELLOW
- **Confidence:** Medium
- **Risk:** The normal release gate is green, but `npm run check:ci` hung before producing output, so it cannot currently be treated as a fast local release-day check.
- **Effort:** hours
- **Evidence:** `package.json:26`; `scripts/lint-obsidian-enforced.mjs:27-44`; `eslint.obsidian.enforced.config.mjs:18-29`.
- **Suggested next action:** Add timeout/logging around the typed Obsidian lint subprocess or document it as CI-only until the hang is understood.

### CH-2026-06-23-#4 — Prior `.DS_Store` commit-noise issue is resolved

- **Status:** Confirmed
- **Category:** no action
- **Severity:** GREEN
- **Confidence:** High
- **Risk:** None for this cycle.
- **Effort:** none
- **Evidence:** `git ls-files .DS_Store wiki/.DS_Store wiki/images/.DS_Store main.js styles.css` lists only `styles.css`; `main.js` is ignored.
- **Suggested next action:** Keep monitoring status before release commits.

---

## Historical Context

| Finding / Theme | Classification |
|---|---|
| `CH-2026-06-23-#1` | Chronic hotspot |
| `CH-2026-06-23-#2` | Stable or improving, but still watch |
| `CH-2026-06-23-#3` | New |
| `CH-2026-06-23-#4` | Previously resolved |

Notes:

- `CH-2026-06-23-#1` continues `CH-2026-06-08-#2`; the files are larger, but the gate/test picture improved.

---

## Do Nothing / Monitor

- **Heuristic dead exports:** The 18 candidates are not confirmed dead; fixtures and exported helpers can be intentionally referenced by tests or future extraction work.
- **Heuristic unused CSS:** The 100 candidates include dynamic modifiers and legacy UI states; CSS audit and CSS drift are clean.
- **Release artifact freshness:** `node esbuild.config.mjs production` succeeded without copy/backup side effects. Final asset upload should still be done by `npm run release`.

---

## Product Doctrine Check

- Author control: OK
- Local-first: OK
- Manuscript safety: OK
- Conservative suggestion matching: OK
- Bulk action safety: OK
- Contributor transparency: OK
- Obsidian-native behavior: OK
- Submission compliance: OK

---

## Escalations To Other Audits

- To Architecture Drift: `CH-2026-06-23-#1`, `CH-2026-06-23-#2` — re-check ownership boundaries before the next panel/settings expansion.
- To Obsidian Ecosystem: `CH-2026-06-23-#3` — typed Obsidian lint remains useful but currently unreliable locally.
- To Refactor Board: `CH-2026-06-23-#1` if it appears in the next cycle again.

---

## Next Cycle

- Run on: 2026-06-29
- Specific things to re-check: `src/main.ts` growth, `ReviewPanel.render`, `createReviewToolbarElement`, typed Obsidian lint behavior, heuristic dead exports.
- If skipping this cadence, why: skip only if no meaningful product code changes land after 1.0.8.
