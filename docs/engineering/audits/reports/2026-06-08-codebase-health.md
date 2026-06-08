# Codebase Health Report — 2026-06-08

**Cadence:** Weekly  
**Audited by:** Codex  
**Branch / commit:** `master` @ `9e9f8cf`  
**Build status at audit time:** `pass` (`npm run typecheck`, `npm run check`, `npm test`, `npm run css-drift -- --maintenance`)  
**Previous report:** none

---

## Executive summary

The post-feature codebase is healthy: typecheck, lint, CSS audit, QA audit, Obsidian compliance, CSS drift, and all 570 tests pass. The new cut-file workflow and idle-panel polish align with the product doctrine: they are opt-in, local-first, and non-destructive. The main hardening work is cleanup rather than correctness: keep repository metadata out of commits, avoid letting the already-large UI/composition files absorb more feature logic, and refresh one stale comment that no longer describes the pending-edits block.

---

## Top metrics

| Metric | This cycle | Prev cycle | Δ |
|---|---:|---:|---:|
| Largest TS file (lines) | `src/main.ts` — 3,104 | n/a | n/a |
| `src/main.ts` (lines) | 3,104 | n/a | n/a |
| `styles.css` (lines) | 5,524 | n/a | n/a |
| Files > 600 lines | 11 | n/a | n/a |
| Functions > 80 lines | 48 | n/a | n/a |
| Dead exports (count) | 6 heuristic candidates, 0 confirmed | n/a | n/a |
| Unused CSS classes (count) | 93 heuristic candidates, 0 confirmed | n/a | n/a |
| `// TODO` / `// FIXME` count | 2 product-code TODOs | n/a | n/a |
| `// SAFE:` exceptions (count) | 12 | n/a | n/a |
| `main.js` size (KB) | 379 KB | n/a | n/a |
| `styles.css` size (KB) | 143 KB | n/a | n/a |

---

## Findings

### CH-2026-06-08-#1 — Tracked `.DS_Store` is now recurring commit noise

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Binary macOS metadata keeps appearing in auto-backup commits and can obscure real source diffs.
- **Effort:** <1 hour
- **Evidence:** `git status --short` reports `M .DS_Store`; `git ls-files .DS_Store` confirms it is tracked; `.gitignore` does not include `.DS_Store`.
- **Suggested next action:** In a cleanup-only commit, add `.DS_Store` to `.gitignore` and remove the tracked file with `git rm --cached .DS_Store` after confirming no workflow intentionally depends on it.

### CH-2026-06-08-#2 — UI/composition files remain the highest-churn hotspots

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Future panel and settings work will become slower and easier to regress because feature state, rendering order, and action wiring are concentrated in a few long files.
- **Effort:** 1-2 days, when paired with the next related feature pass
- **Evidence:** `src/main.ts` is 3,104 lines, `src/ui/EditorialistSettingTab.ts` is 1,728, `src/ui/ReviewPanel.ts` is 1,685, `src/ui/EditorialistModal.ts` is 1,203, and `styles.css` is 5,524. Function-like bodies over 80 lines include `createReviewToolbarElement` at 389 lines and `ReviewPanel.render` at 190 lines.
- **Suggested next action:** Do not refactor immediately. On the next idle-panel or settings change, move one complete surface into a focused module with tests: either the idle workspace composition from `ReviewPanel.render()` or the Configuration/Cut settings section from `EditorialistSettingTab`.

### CH-2026-06-08-#3 — Cut backup orchestration is correct but adds more responsibility to `main.ts`

- **Status:** Confirmed
- **Category:** stabilization
- **Severity:** YELLOW
- **Confidence:** Medium
- **Risk:** If the cut feature grows into synthetic annotations, side-panel previews, or richer selection handling, `main.ts` will become the place where editor-selection policy, review-session fallback policy, notices, and archive IO are coupled.
- **Effort:** 1 day if the feature expands
- **Evidence:** `src/main.ts:762` implements `backupSelectionToCutFile()`, `src/main.ts:800` implements `resolveCutBackupSource()`, while `src/core/CutArchiveService.ts` correctly owns path resolution and vault writes.
- **Suggested next action:** Keep as-is for the current shipped feature. If the next cut-file iteration adds annotation history or a lower side-panel view, extract a `CutBackupCoordinator` that owns source resolution and notice messaging while leaving `CutArchiveService` as the pure archive writer.

### CH-2026-06-08-#4 — Pending-edits comment describes the old chip-style CTA

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** GREEN
- **Confidence:** High
- **Risk:** Low runtime risk, but future maintainers will read the comment as if the old visual contract still exists.
- **Effort:** <15 minutes
- **Evidence:** `src/ui/panels/ReviewPanelIdleSections.ts:267` still says the workspace block is a slim CTA mirroring the compact onboarding chip, but the implementation at `src/ui/panels/ReviewPanelIdleSections.ts:274` now renders a formal expandable section with per-scene rows.
- **Suggested next action:** Update the comment during the next touched-file cleanup; no standalone PR needed.

---

## Historical Context

| Finding / Theme | Classification |
|---|---|
| `CH-2026-06-08-#1` | New |
| `CH-2026-06-08-#2` | New baseline |
| `CH-2026-06-08-#3` | New |
| `CH-2026-06-08-#4` | New |

Notes:

- This is the first archived codebase-health report, so the large-file metrics are a baseline rather than a trend.

---

## Do Nothing / Monitor

- **Heuristic dead exports:** A simple exported-symbol scan found 6 single-reference candidates, including `ContributorResolution`, `isSuggestionResolved`, and `formatContributorProviderModel`. These are not confirmed dead without a TypeScript-aware dependency pass, so do not prune from this audit alone. Re-check if a future refactor already touches those modules.
- **Heuristic unused CSS classes:** A string scan found 93 class names not directly referenced in TypeScript, but many panel classes are dynamic modifiers or legacy surfaces. CSS audit and CSS drift are clean, so treat this as a future CSS-specific audit item, not a codebase-health blocker.
- **Release artifact freshness:** `main.js` is ignored and was not rebuilt during this audit because `npm run build` has copy-to-vault side effects. Run `npm run release:check` before any release-oriented handoff.
- **Product TODOs:** The two product-code TODOs are scoped and not release blockers: rewrite-capture follow-up in `src/main.ts` and normalized matching phase 2 in `src/core/MatchEngine.ts`.

---

## Product Doctrine Check

- Author control: OK — cut backup is explicit and preservation-only; idle-panel reordering only changes discovery.
- Local-first: OK — no new network calls or telemetry surfaced in the audit.
- Manuscript safety: OK — cut backup writes archive content and does not mutate manuscript text or suggestion status.
- Conservative suggestion matching: OK — suggestion fallback uses the selected cut/condense target from the session note, not a guessed active-file target.
- Bulk action safety: OK — no new bulk destructive action was introduced.
- Contributor transparency: OK — cut metadata preserves source, scene, contributor, reason, operation, suggestion id, and timestamp, with metadata sanitization.
- Obsidian-native behavior: OK — `npm run check` passed lifecycle, DOM, style, and command-label gates.
- Submission compliance: OK — Obsidian submission compliance passed.

---

## Escalations to other audits

- → Architecture Drift: `CH-2026-06-08-#2`, `CH-2026-06-08-#3` — watch whether UI/composition concentration worsens as cut-file and panel features evolve.
- → Obsidian Ecosystem: none.
- → Refactor Board (next monthly): `CH-2026-06-08-#2` — use this report as the first baseline for large-file and long-function thresholds.

---

## Next cycle

- Run on: 2026-06-15
- Specific things to re-check: `.DS_Store` tracking, whether cut-file feature growth stayed in `main.ts`, pending-edits comment drift, and whether large UI files continued growing.
- If skipping this cadence, why: skip only if there is no meaningful product change before the next Monday audit.
