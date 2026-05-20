# Prompt: Weekly Architecture Drift Audit — Editorialist

You are running the **Weekly Architecture Drift Audit** for the
Editorialist Obsidian plugin. Your job is to detect places where feature
revisions have layered patches instead of clarifying ownership — and to
recommend clarifications, not rewrites. You do **not** modify product
code.

## Before you begin

Read:

- `CLAUDE.md` (root)
- `docs/CODE-STANDARDS.md`
- `docs/engineering/audits/README.md`
- The most recent Codebase Health report under
  `docs/engineering/audits/reports/`, if any — pick up its "Escalations".

Template:
`docs/engineering/audits/templates/architecture-drift-report.md`. Save
to `docs/engineering/audits/reports/YYYY-MM-DD-architecture-drift.md`.

## Scope

Editorialist's `src/` is organized into clear architectural seams:

- `commands/` — command registration surface.
- `controllers/` — orchestration of user-driven flows.
- `core/` — pure domain logic; should have no Obsidian imports.
- `models/` — data shapes.
- `orchestrators/` — multi-step workflows (e.g. import, review,
  pending-edits).
- `services/` — side-effecting integrations (vault, requestUrl,
  contributor sources).
- `state/` — canonical in-memory state.
- `ui/` — views, modals, panels.
- `main.ts` — plugin entry; expected to be a thin wiring layer.

The audit's job is to confirm those boundaries still hold, and to
surface where they don't.

## What to look for

For each finding, cite specific files and line ranges. Distinguish
**Confirmed** from **Hypothesis**.

1. **State fragmentation** — the same piece of truth held in multiple
   places. `state/` should own it; `services/` and `controllers/` should
   read/derive. Flag any divergent caches or mirrored flags.
2. **Layer leakage** —
   - `core/` importing from `obsidian` or from `ui/`.
   - `services/` reaching into `ui/` DOM.
   - `ui/` mutating `state/` directly instead of via a controller.
   - `main.ts` accumulating logic that belongs in `controllers/` or
     `orchestrators/`.
3. **Duplicated controllers / orchestrators** — two paths that do the
   same high-level thing (two import paths, two review-start paths, two
   apply-suggestion paths).
4. **Modal ownership confusion** — modals that close themselves vs.
   modals closed by callers; modals that mutate state directly instead
   of returning a result to a controller.
5. **Command registration drift** — commands defined in more than one
   place, commands with stale `id`s, commands missing from the palette,
   command names that include "Editorialist" (banned — Obsidian adds it
   automatically), command names that are placeholders ("Begin",
   "Start") instead of descriptive verbs.
6. **Suggestion / matching path duplication** — Editorialist's core
   value is *conservative* matching. Flag any place where two different
   matching strategies coexist without a single authoritative entry
   point, or where match tolerances have diverged across call sites.
7. **Naming / terminology inconsistencies** — different names for the
   same concept (e.g. "review" vs "revision" vs "edit"; "contributor"
   vs "reviewer" vs "source"; "batch" vs "import"). List the variants
   and recommend a canonical name. Do NOT propose mass rename — just
   flag.
8. **Layered patches** — features whose `if`/branch count has grown
   each release without a corresponding refactor. Use `git log -p
   --follow` on suspect files to confirm.
9. **Fallback creep** — silent defaults, `||`/`??` chains masking
   missing data, try/catch returning empty values. Especially dangerous
   in suggestion-matching paths where a silent fallback can apply the
   wrong edit.
10. **Cleanup / unload gaps** — registered events, intervals,
    observers, or DOM nodes not torn down on view/plugin unload.
    Confirm `register*` helpers are used; flag any raw
    `addEventListener` without paired cleanup.

## Rules

- Cite file paths with line ranges.
- Tag each finding with one or more **architecture concerns**:
  `state | ownership | boundary | command | orchestration | matching | terminology | fallback | cleanup`.
- Recommend the smallest clarifying change.
- Do not propose multi-week refactors here — escalate them with
  severity and rationale to the **Monthly Refactor Board**.
- Every finding includes: **risk**, **effort**, **confidence**,
  **suggested next action**, **category**
  (`cleanup | stabilization | modernization | doctrine correction | test hardening | no action`).
- Include a **"Do Nothing / Monitor"** section.

## Product Doctrine Check

Re-evaluate suspect areas against:

- Author control
- Local-first
- Manuscript safety
- Conservative suggestion matching
- Bulk action safety
- Contributor transparency
- Obsidian-native behavior
- Submission compliance

A doctrine violation auto-promotes the finding to **ORANGE** or **RED**.

## Output

Fill the template. Number findings as `AD-YYYY-MM-DD-#N`. Under 1000
lines.

## OUTPUT FORMAT

Primary output must always be valid Markdown suitable for:
- git versioning
- long-term archival
- code review
- diffing

**HTML rendering for this cadence: DISABLED.** Weekly Architecture
Drift is reviewed against the prior week's report — diffability is the
point. Do not emit an HTML version unless this policy is changed in
`docs/engineering/audits/README.md`.
