# Quality-Gate → Official ESLint Rule Mapping

Decision artifact for adding `eslint-plugin-obsidianmd` to Editorialist without
mistaking generic Obsidian guidance for project-specific doctrine.

Status: **selective ratchet enforcement**. The full official preset is
report-only. Two confirmed overlap rules are enforced through a committed
baseline in `scripts/eslint-obsidian-enforced-baseline.json`:
`obsidianmd/no-static-styles-assignment` and `obsidianmd/prefer-window-timers`.

## Existing Local Gates

- `npm run lint` remains the existing Editorialist ESLint gate.
- `npm run css-check`, `css-audit`, `qa-audit`, `compliance`, `test`, and
  `css-drift -- --maintenance` remain project gates.
- `npm run build-only` is the side-effect-free production bundle used in CI.
- `npm run build` still performs local dev copy/backup behavior and is not used
  by CI.

## Report-Only Obsidian Preset

First run of `npm run lint:obsidian:report`:

- **88** total findings.
- **44** from `obsidianmd/*` rules.
- Top official Obsidian rules:
  - `obsidianmd/ui/sentence-case`: 17
  - `obsidianmd/no-static-styles-assignment`: 10
  - `obsidianmd/prefer-window-timers`: 7
  - `obsidianmd/prefer-active-doc`: 6
  - `obsidianmd/no-unsupported-api`: 3
  - `obsidianmd/prefer-instanceof`: 1

## Enforced Ratchet

| Rule | Baseline | Enforcement |
|---|---:|---|
| `obsidianmd/no-static-styles-assignment` | 10 | Blocking ratchet: fails on increase. |
| `obsidianmd/prefer-window-timers` | 7 | Blocking ratchet: fails on increase. |

Implementation:

- `eslint.obsidian.report.config.mjs` runs the full recommended preset in
  report-only mode.
- `scripts/lint-obsidian-report.mjs` writes the transient summary to
  `.gate-logs/eslint-obsidian.json` and always exits 0.
- `eslint.obsidian.enforced.config.mjs` contains only the selected enforced
  rule subset.
- `scripts/lint-obsidian-enforced.mjs` compares selected-rule counts to
  `scripts/eslint-obsidian-enforced-baseline.json`.
- `npm run lint:obsidian` runs the ratcheted selected-rule gate.
- `npm run lint:obsidian:report` runs the full official preset report.

## Keep Project Gates

Do not delete these just because the official preset exists:

- `scripts/qa-audit.mjs`: Editorialist source hygiene and project-specific
  safe-comment policy.
- `scripts/obsidian-compliance.mjs`: release/submission checks and reviewer
  expectations.
- `stylelint.config.mjs`: CSS namespace discipline.
- `scripts/css-audit.mjs` and `scripts/css-drift-check.mjs`: CSS budget and
  drift controls.

## Future Promotion Candidates

Promote only after reviewing real findings:

- `obsidianmd/ui/sentence-case`: useful, but user-facing copy cleanup, not a
  safety gate yet.
- `obsidianmd/prefer-active-doc`: useful, but likely requires behavior review.
- `obsidianmd/no-unsupported-api`: useful, but confirm minAppVersion and rule
  coverage before making blocking.
- `obsidianmd/prefer-instanceof`: low count, good cleanup candidate.
