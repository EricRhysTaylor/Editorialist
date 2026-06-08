Post-feature audit, cleanup, and harden pass. Run after a new feature or
significant addition is implemented and functioning, before release.

This is NOT a feature-adding pass. Goal: simplify, normalize, and stabilize
without changing intended behavior.

1. Read:
   - `CLAUDE.md` (root)
   - `docs/CODE-STANDARDS.md`
   - `docs/engineering/standards/feature-audit-playbook.md`
   - `docs/engineering/audits/README.md` (severity scale, longitudinal memory,
     and the eight Editorialist Product Doctrine pillars)

2. Scope the feature surface from git (last release → HEAD + uncommitted),
   read the whole surface, and establish a clean baseline with
   `npx tsc --noEmit` and `npx vitest run`.

3. Default to REPORT-ONLY. Produce the prioritized audit report and get
   approval before editing. Verify only with `npm run check` /
   `npx tsc --noEmit` / `npx vitest run` / `npm run build-only` — never
   `npm run build` mid-audit (it copies into the vault and the backup hook
   commits + pushes to `master`). The closing build-and-commit is a single
   deliberate final step once approved fixes have landed.

4. Work the 9 audit dimensions + the Product Doctrine Check, and produce the
   required output sections exactly as defined in `feature-audit-playbook.md`.

Apply the Editorialist doctrine:

- prefer deletion over accommodation
- remove duplicate computation paths; enforce a single source of truth
- never add fallback logic to "stabilize" — fail clearly (Notice / blocked
  state); annotate every `?? literal` / `|| literal` / `any` with `// SAFE:`
- maintain deterministic runtime behavior
- `editorialist-*` / `ert-*` classes only; no new `rt-*` classes; no hardcoded
  hex outside `ContributorBrandMarks.ts`; no inline styles
- schema-stamp persisted data (`EDITORIALIST_PLUGIN_DATA_VERSION` +
  `migratePluginData`); keep user data portable, human-readable, and local
- manuscript safety: never overwrite, lose, or silently mutate manuscript text;
  safety artifacts stay non-destructive and never become an alternate source of
  truth

$ARGUMENTS
