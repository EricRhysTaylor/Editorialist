# Feature Audit & Stabilization Playbook

Authoritative procedure for the **post-feature audit, cleanup, and harden
pass** in Editorialist. Run this after any new feature or significant addition
is implemented and functioning, before it is considered release-ready.

This pass exists because iterative revisions reliably introduce: duplicated
logic, naming drift, bloated view/controller code, temporary compatibility
hacks, scattered state ownership, persistence risks, architectural leakage, and
UI inconsistency.

**Goal: simplify, normalize, and stabilize the feature without changing
intended behavior.** It is NOT a feature-adding pass.

This playbook is adapted from the Radial Timeline feature-audit playbook so the
same doctrine, severity scale, and longitudinal-memory taxonomy apply across
both projects. It is subordinate to:

- `CLAUDE.md` (root) — repo conventions and most-violated rules.
- `docs/CODE-STANDARDS.md` — the single source of truth for Obsidian
  submission rules, DOM/TS hygiene, CSS rules, and release process.
- `docs/engineering/audits/README.md` — severity scale, longitudinal memory,
  and the eight **Editorialist Product Doctrine** pillars.

---

## Operating rules (Editorialist-specific)

- **Report first.** Default mode is read-only: produce the audit report with
  prioritized findings and get approval before editing. Apply fixes only when
  the user opts in (low-risk-only / non-architectural / full).
- **Verification uses `npm run check` (or `npx tsc --noEmit` + `npx vitest run`
  + `npm run build-only`).** Do NOT run `npm run build` for mid-audit
  verification — it copies into the vault and the backup hook commits + pushes
  to `master`. The closing build-and-commit happens once, after approved fixes
  land, as a deliberate final step — not as a verification probe.
- **Complement the gates, don't re-implement them.** `qa-audit.mjs`,
  `obsidian-compliance.mjs`, `css-audit.mjs`, and `css-drift-check.mjs` already
  enforce DOM/TS hygiene, submission rules, and CSS discipline mechanically.
  The audit's job is *trend* and *root cause*, not pass/fail.
- **Obey the doctrine.** Prefer deletion over accommodation. Never add fallback
  logic to "stabilize." Fail clearly (Notice / blocked state) instead of
  silently substituting. Every `?? literal` / `|| literal` default and every
  `any`/`as any` needs a same-line `// SAFE:` (or explanatory) comment.
- **No speculative abstractions.** Do not future-proof. Reduce complexity; do
  not add layers.
- **Preserve behavior, settings compatibility, and migrations** unless a change
  is explicitly approved. Persisted shapes stay schema-stamped via
  `EDITORIALIST_PLUGIN_DATA_VERSION` + `migratePluginData`.
- **`editorialist-*` / `ert-*` classes only** for new chrome; never introduce
  `rt-*` classes. Colors come from Obsidian CSS variables; no hardcoded hex
  outside `ContributorBrandMarks.ts`.
- **Extraction order when refactoring:** types → pure helpers → services →
  renderers. Moving code without reducing branches/duplication/coupling is not
  a successful refactor.

---

## Scoping the pass

1. Identify the feature surface from git: `git diff --stat <last-release>..HEAD`
   plus uncommitted changes. List every touched service, view, settings
   section, type, style block, command, and test.
2. Read the whole surface — do not sample. Oversized files are read in ranges.
3. Establish a clean baseline: `npx tsc --noEmit` and `npx vitest run` before
   proposing any change.

---

## Audit dimensions

For each, identify issues and (on approval) refactor toward the stated target.

1. **Architecture** — business logic in UI, rendering in services, duplicated
   derivation, scattered state ownership, hidden coupling, oversized
   view/controller logic, unnecessary abstraction. Target: clear ownership,
   simple data flow, centralized derivation, isolated responsibilities. Keep
   `ReviewPanel`/`main.ts` orchestrating, not implementing; keep
   `IdleSectionsHost`-style host interfaces small and query/event-oriented.

2. **Naming** — normalize across settings, types, services, commands, UI
   labels, helpers, notices/tooltips, and persisted fields. Remove legacy
   terminology, partially renamed systems, and misleading identifiers. Match
   current Editorialist feature language (Contributors, sweeps, pending edits,
   cut files, etc.).

3. **Dead code** — unused helpers, abandoned migration logic, obsolete
   comments, unreachable branches, temporary compatibility code, resolved
   TODOs, unused settings paths, duplicate utilities, and orphaned exports left
   behind by an extraction or rename.

4. **Type safety** — eliminate unannotated `any`/`as any`/`@ts-expect-error`,
   unsafe casts, nullable drift, duplicated type definitions, weakly typed
   state. Prefer centralized types, discriminated unions, normalized
   interfaces, and safe persistence boundaries. Remember
   `metadataCache.getFileCache().frontmatter` is effectively `any` — frontmatter
   reads go through typed helpers, never inline key ladders.

5. **State & persistence** — single source of truth; settings normalization run
   once (not on every read); migration safety; safe hydration and defaults; no
   duplicated/stale derived state; no mutation leaks. Look for race conditions,
   stale references, and hidden persistence assumptions. Confirm new persisted
   shapes flow through `migratePluginData` defaults/normalization and are
   covered by round-trip + malformed-input tests.

6. **UX consistency** — spacing, hierarchy, section headers, button patterns,
   card layouts, notices, empty states, tooltip tone, modal structure,
   terminology. Remove drift introduced during iteration.

   **CSS variable scope check (mandatory for any new chrome).** For every
   element the feature introduces, verify its `var(--editorialist-*)` and
   `var(--ert-*)` references resolve. Custom properties defined under a scoped
   root do not cascade to elements appended elsewhere (popovers, portals,
   `document.body`); for those surfaces use Obsidian's global tokens
   (`--size-4-*`, `--background-*`, `--text-*`). New rules must use existing
   theme variables — no hardcoded hex, no inline `element.style` except
   `setProperty("--css-var", …)`.

7. **Performance** — repeated vault scans, unnecessary recomputation, repeated
   markdown/frontmatter parsing, avoidable async churn, excessive panel
   re-renders, duplicated selectors. Prefer cached derivations and centralized
   computation. Watch debounced/interval work running while idle.

8. **File structure** — oversized files, god objects, bloated views, mixed
   responsibilities, scattered feature logic. Move toward cohesive, smaller,
   locally-owned modules — without fragmenting into micro-files. Defer large
   extractions unless they clearly reduce complexity now.

9. **Release safety** — fragile assumptions, migration risks, persistence edge
   cases, unsafe mutations, stale UI state, hidden coupling, feature
   interactions, schema drift, partial normalization. Verify backward
   compatibility, a clean `tsc` + test baseline, and that `npm run check`
   (typecheck + lint + css + qa-audit + compliance) and `css-drift` pass.

### Product Doctrine Check (required)

Evaluate the feature against the eight Editorialist pillars in
`docs/engineering/audits/README.md` — Author control, Local-first, Manuscript
safety, Conservative suggestion matching, Bulk action safety, Contributor
transparency, Obsidian-native behavior, Submission compliance. Any violation is
automatically **ORANGE or higher** regardless of size. Manuscript-safety is the
sharpest yardstick for write-side features: safety artifacts (e.g. cut files)
must be non-destructive and must never become an alternate manuscript source of
truth.

### Data ownership note

User-generated data (sessions, logs, history, cut archives) must remain the
author's: prefer a portable, human-readable, vault-local artifact that survives
in-settings caps and plugin uninstall. Keep it local unless upload is
explicitly approved. Stamp persisted plugin data with the schema version.

---

## Severity & confidence

Use the audits README scale: **GREEN** (no action) / **YELLOW** (localized,
single-PR cleanup) / **ORANGE** (multi-file drift, short stabilization sprint) /
**RED** (doctrine violation or blocking — refactor first). Each finding carries
a **confidence** (Low / Medium / High). Low-confidence findings stay **Monitor**
until a second pass confirms them. When in doubt, recommend Monitor over
refactor.

---

## Required output

1. Cleanup summary
2. Risks/issues found (prioritized: release-blocking → high → medium → low),
   each with severity + confidence + file:line evidence
3. Product Doctrine Check (the eight pillars, pass/flag each)
4. Refactors performed (only if fixes were approved)
5. Dead code removed
6. Naming normalizations
7. Deferred concerns
8. Recommended follow-up work
9. Confirmation that feature behavior remains intact
10. Confirmation that release/build safety was verified (`npm run check` +
    `vitest` + `css-drift`)

---

## Constraints

- Do NOT add features, redesign working UX, or introduce speculative
  abstractions.
- Do NOT rewrite stable systems without clear benefit.
- Preserve backward compatibility, intended UX behavior, and settings
  migrations unless explicitly approved.
- Prefer simplification over cleverness.
