# Architecture Drift Report — 2026-06-23

**Cadence:** Weekly  
**Audited by:** Codex  
**Branch / commit:** `master` @ `9c6dd67`  
**Previous report:** none  
**Input reports loaded:** `reports/2026-06-08-codebase-health.md`, `reports/2026-06-23-codebase-health.md`

---

## Executive Summary

The product architecture is stable enough for 1.0.8, with no release-blocking ownership or doctrine issue. The clearest drift is that the documented `core/` boundary is aspirational rather than true: several `core/` modules still import Obsidian `App` / `TFile` and perform vault work. `main.ts` is also still the feature-wiring pressure point, though recent command registration and modal patterns are healthy.

---

## Architecture Map Snapshot

- `commands/` — one command registration module with stable IDs and descriptive names.
- `controllers/` — not present; controller responsibilities are currently split between `main.ts` and `orchestrators/`.
- `core/` — mixed: many pure parsing/matching helpers, plus vault-aware services such as import, cut archive, and vault scope.
- `models/` — data shapes for contributors, imports, suggestions, and registry state.
- `orchestrators/` — multi-step review, import, pending-edits, session, toolbar, and workflow operations.
- `services/` — registry, Editorialism persistence, workflow facade, and registry projections.
- `state/` — contributor directory, debounced persistence, review store, and small state utilities.
- `ui/` — Obsidian views, modals, toolbar, panels, primitives, and view models.
- `main.ts` — large plugin shell and wiring layer; still owns several user-facing action policies.

---

## Findings

### AD-2026-06-23-#1 — `core/` still contains Obsidian-facing services

- **Status:** Confirmed
- **Concerns:** boundary | ownership
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Pure domain code and vault IO are harder to reason about separately; future matching/import changes may need Obsidian test scaffolds even when the logic should be pure.
- **Effort:** 1-2 days, only when touching the import/cut/scope surfaces
- **Evidence:** `src/core/ImportEngine.ts:1-14`, `src/core/ImportEngine.ts:55-80`, `src/core/ImportEngine.ts:114-129`; `src/core/CutArchiveService.ts:1-3`, `src/core/CutArchiveService.ts:106-148`; `src/core/VaultScope.ts:1`, `src/core/VaultScope.ts:56-64`, `src/core/VaultScope.ts:110-124`.
- **Suggested next action:** Do not move files for 1.0.8. On the next import/cut/scope change, split pure formatting/matching helpers from vault-facing service classes and place the latter under `services/`.
- **Cycles seen:** 1

### AD-2026-06-23-#2 — `main.ts` remains the feature-policy hub

- **Status:** Confirmed
- **Concerns:** ownership | orchestration
- **Category:** stabilization
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** More panel or editor-menu work will keep increasing the cost of reviewing `main.ts` and can blur policy ownership between plugin shell, orchestrators, and services.
- **Effort:** 1-2 days, opportunistic
- **Evidence:** `src/main.ts:368-475` wires load lifecycle, views, ribbon, commands, editor menu, workspace events, and editor-change debounce; `src/main.ts:951-980` owns cut-backup source/action messaging; `src/main.ts:913-921` still carries rewrite-capture follow-up policy.
- **Suggested next action:** Keep 1.0.8. The next editor-menu or cut-file change should extract an editor-action coordinator that owns menu item policy and notices.
- **Cycles seen:** 2

### AD-2026-06-23-#3 — Modal ownership is improving

- **Status:** Confirmed
- **Concerns:** ownership | cleanup
- **Category:** no action
- **Severity:** GREEN
- **Confidence:** High
- **Risk:** Low. Newer modal work is converging on a clean result-returning pattern.
- **Effort:** none now
- **Evidence:** `src/ui/modals/PromiseModal.ts:1-62` centralizes open/close/settle behavior; `src/ui/modals/AuthorQueryModal.ts:4-8`, `src/ui/modals/AuthorQueryModal.ts:53-59` returns trimmed input and leaves marker insertion to the caller.
- **Suggested next action:** Reuse `PromiseModal` for any new prompt-style modal. Do not rewrite `EditorialistModal` just for consistency.
- **Cycles seen:** 1

### AD-2026-06-23-#4 — Command registration is healthy after recent additions

- **Status:** Confirmed
- **Concerns:** command
- **Category:** no action
- **Severity:** GREEN
- **Confidence:** High
- **Risk:** Low.
- **Effort:** none
- **Evidence:** `src/commands/Commands.ts:3-70` registers all commands in one place, no names include `Editorialist`, editor-only actions use `editorCallback`, and no default hotkeys are present.
- **Suggested next action:** Keep command registration centralized.
- **Cycles seen:** 1

---

## Historical Context

| Finding / Theme | Classification |
|---|---|
| `AD-2026-06-23-#1` | New baseline |
| `AD-2026-06-23-#2` | Chronic hotspot |
| `AD-2026-06-23-#3` | Stable or improving |
| `AD-2026-06-23-#4` | Stable or improving |

---

## Cross-Cycle Patterns

| ID | Title | Cycles seen | Current severity | Escalate? |
|---|---:|---:|---|---|
| `AD-2026-06-23-#2` | `main.ts` feature-policy hub | 2 | YELLOW | Escalate if it grows again next cycle |

---

## Do Nothing / Monitor

- **Editorialism view split:** two registered views still exist (`review` and `editorialism`) but they now share the Ed identity and mode toggle. Monitor user-facing consistency, not file count.
- **ReviewPanel size:** large, but view-model extraction is already present. Extract only around the next concrete panel change.

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

- `AD-2026-06-23-#1` — consider whether vault-aware classes should move out of `core/` if this repeats.
- `AD-2026-06-23-#2` — track `main.ts` as a recurring hotspot.

---

## Next Cycle

- Run on: 2026-06-29
- Specific seams to re-check: import/cut/scope ownership, editor-menu action policy, `ReviewPanel.render`, settings tab section extraction.
- If skipping this cadence, why: skip only if no feature code changes land after 1.0.8.
