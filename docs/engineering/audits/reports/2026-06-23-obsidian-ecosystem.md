# Obsidian Ecosystem Report — 2026-06-23

**Cadence:** Biweekly  
**Audited by:** Codex  
**Branch / commit:** `master` @ `9c6dd67`  
**Plugin `minAppVersion`:** `1.7.2`  
**Installed `obsidian` types version:** `^1.13.1`  
**`scripts/obsidian-compliance.mjs` status:** `pass` via `npm run check`  
**Web access available:** Yes  
**Previous report:** none

---

## Executive Summary

Editorialist is aligned with the current Obsidian submission basics: manifest and package hygiene are clean, command labels avoid plugin-name duplication, views use Obsidian lifecycle APIs, and release assets are the expected three files. The only modernization opportunity found is future-facing: Obsidian 1.13 introduces declarative settings, but Editorialist still supports `minAppVersion` 1.7.2, so the current imperative settings tab is appropriate for this release. No Obsidian ecosystem issue blocks 1.0.8.

---

## Findings

### OE-2026-06-23-#1 — Release-submission contract is clean

- **Status:** Confirmed
- **Area:** manifest | package | release-assets
- **Category:** no action
- **Severity:** GREEN
- **Confidence:** High
- **Risk:** Low; this is release-ready.
- **Effort:** none
- **Evidence (in repo):** `manifest.json:2-9`; `versions.json:10-11`; `package.json:51-65`; `.github/workflows/release-build.yml:37-50`.
- **Evidence (external):** Obsidian Manifest docs, fetched 2026-06-23, `https://docs.obsidian.md/Reference/Manifest`; Obsidian plugin guidelines, fetched 2026-06-23, `https://docs.obsidian.md/Plugins/Releasing/Plugin%2Bguidelines`.
- **Suggested next action:** Continue with the release workflow; attach only `manifest.json`, `main.js`, and `styles.css`.

### OE-2026-06-23-#2 — Commands and lifecycle follow Obsidian-native expectations

- **Status:** Confirmed
- **Area:** lifecycle | workspace | commands | editor/CM6
- **Category:** no action
- **Severity:** GREEN
- **Confidence:** High
- **Risk:** Low.
- **Effort:** none
- **Evidence (in repo):** `src/main.ts:368-392`, `src/main.ts:477-491`; `src/commands/Commands.ts:3-70`; `src/ui/ReviewPanel.ts:84-103`; `src/ui/EditorialismPanel.ts:56-90`; `src/ui/toolbar/ToolbarKeyTracker.ts:48-95`; `src/orchestrators/ToolbarOverlayController.ts:68-76`, `src/orchestrators/ToolbarOverlayController.ts:112-125`.
- **Evidence (external):** Obsidian plugin guidelines, fetched 2026-06-23, `https://docs.obsidian.md/Plugins/Releasing/Plugin%2Bguidelines`; Obsidian plugin self-critique checklist, fetched 2026-06-23, `https://docs.obsidian.md/oo/plugin`.
- **Suggested next action:** Keep using `register*` helpers and editor-scoped commands for editor-only actions.

### OE-2026-06-23-#3 — Declarative settings are a future option, not a 1.0.8 blocker

- **Status:** Confirmed
- **Area:** settings
- **Category:** modernization
- **Severity:** GREEN
- **Confidence:** High
- **Risk:** Low now. Moving too early would complicate support for `minAppVersion` 1.7.2.
- **Effort:** days, only if raising `minAppVersion`
- **Evidence (in repo):** `manifest.json:5`; `src/ui/EditorialistSettingTab.ts:1`; `package.json:60`.
- **Evidence (external):** Obsidian declarative settings guide, fetched 2026-06-23, `https://docs.obsidian.md/plugins/guides/migrate-declarative-settings`; Obsidian Settings docs, fetched 2026-06-23, `https://docs.obsidian.md/Plugins/User%2Binterface/Settings`.
- **Suggested next action:** Do nothing for 1.0.8. Revisit only when intentionally raising the supported Obsidian baseline to 1.13+.

### OE-2026-06-23-#4 — Startup path is reasonable but should stay watched

- **Status:** Confirmed
- **Area:** performance
- **Category:** stabilization
- **Severity:** GREEN
- **Confidence:** Medium
- **Risk:** Low for release, but `onload()` already does data load, profile persistence, active-scope refresh, view registration, event registration, and pending-edit summary refresh.
- **Effort:** hours if measured slow in Obsidian
- **Evidence (in repo):** `src/main.ts:368-475`.
- **Evidence (external):** Obsidian load-time guide, fetched 2026-06-23, `https://docs.obsidian.md/plugins/guides/load-time`.
- **Suggested next action:** After release, use Obsidian's startup timer in a real vault before changing anything. Do not optimize by guesswork.

### OE-2026-06-23-#5 — Obsidian typed lint should be made observable

- **Status:** Confirmed
- **Area:** package
- **Category:** test hardening
- **Severity:** YELLOW
- **Confidence:** Medium
- **Risk:** The normal compliance gate passes, but the stricter typed Obsidian lint wrapper hung locally and did not provide a report.
- **Effort:** hours
- **Evidence (in repo):** `package.json:26`; `scripts/lint-obsidian-enforced.mjs:27-44`; `eslint.obsidian.enforced.config.mjs:18-29`.
- **Evidence (external):** Obsidian plugin self-critique checklist recommends scanning for deprecated methods, fetched 2026-06-23, `https://docs.obsidian.md/oo/plugin`.
- **Suggested next action:** Add timeout/progress logging to the wrapper or move the typed report to a CI job with a runtime limit.

---

## Historical Context

| Finding | Classification |
|---|---|
| `OE-2026-06-23-#1` | New baseline |
| `OE-2026-06-23-#2` | New baseline |
| `OE-2026-06-23-#3` | Deferred by doctrine |
| `OE-2026-06-23-#4` | Monitor |
| `OE-2026-06-23-#5` | New |

---

## "Requires Verification" Queue

- None.

---

## Do Nothing / Monitor

- **Mobile support:** `isDesktopOnly` is true, so Node/mobile compatibility is not a release blocker.
- **Declarative settings:** monitor Obsidian 1.13 adoption; do not move while `minAppVersion` remains 1.7.2.
- **Startup cost:** measure in Obsidian before changing startup work.

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

## Escalations To Refactor Board

- None for 1.0.8. Track `OE-2026-06-23-#5` as a tooling hardening item.

---

## Next Cycle

- Run on: 2026-07-07
- Specific APIs / surfaces to re-check: typed Obsidian lint, declarative settings docs, startup timing in a real vault, release workflow asset upload.
- If skipping this cadence, why: skip only if no release or Obsidian API changes occur before the next cadence.
