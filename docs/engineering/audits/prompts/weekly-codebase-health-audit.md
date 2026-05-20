# Prompt: Weekly Codebase Health Audit — Editorialist

You are running the **Weekly Codebase Health Audit** for the Editorialist
Obsidian plugin. Your job is to detect mechanical drift and produce a
prioritized cleanup list. You do **not** modify product code.

## Before you begin

Read so your recommendations align with project doctrine:

- `CLAUDE.md` (root)
- `docs/CODE-STANDARDS.md`
- `docs/engineering/audits/README.md`
- The most recent prior report under `docs/engineering/audits/reports/`,
  if any.

Use the report template at
`docs/engineering/audits/templates/codebase-health-report.md`. Save the
finished report to
`docs/engineering/audits/reports/YYYY-MM-DD-codebase-health.md`.

## Verification commands (read-only)

Use these for evidence; do not commit anything they produce.

- `npm run typecheck` — TS health
- `npm run check` — typecheck + lint + css + qa-audit + compliance
- `npm test` — vitest suite
- `git log --since="7 days ago" --stat` — recent activity

Do **not** run `npm run build` or `npm run backup` for verification —
both produce side effects (vault copy, optional backup) you don't want
from an audit run.

## Scope

Inspect, at minimum:

- `src/` — `commands/`, `controllers/`, `core/`, `models/`,
  `orchestrators/`, `services/`, `state/`, `ui/`, and `main.ts`.
- `styles.css` — built output. Note size and any obvious bloat.
- `tests/` and any `*.test.ts` files near source.
- `scripts/` — only flag duplication or dead scripts; do not propose
  refactors here unless they block product code.

Skip: `node_modules/`, `main.js` (built output), `.git/`.

## What to look for

For each finding, cite specific files and line ranges.

1. **Large files** — TypeScript files over ~600 lines or CSS files over
   ~1500 lines. `src/main.ts` is already very large; note its current
   size and whether it grew since the last report. List the top 10 by
   line count.
2. **Long methods / functions** — bodies over ~80 lines, or visibly
   complex (deep nesting, many branches).
3. **Duplicated utilities** — near-identical helpers across files.
   Look especially at date/time helpers, path normalization,
   debounce/throttle, formatters, DOM builders, and any
   suggestion-matching helpers.
4. **Dead exports** — exported symbols with zero in-repo references.
5. **Unused CSS** — classes with no producer in TS. Cross-check with
   `scripts/css-audit.mjs` output if available.
6. **Brittle tests** — tests that skip, are `.only`'d, depend on real
   time/clocks/network, or rely on snapshot comparisons without
   normalization.
7. **Rising complexity** — files with many `if/else if` chains, deeply
   nested conditionals, or growing switch statements. Flag candidates
   for pattern simplification (do not propose the simplification here —
   that's the Refactor Board's job).
8. **Failing patterns** —
   - `any` / `as any` / `@ts-expect-error` without a same-line `// SAFE:`
     comment (qa-audit should catch these on build, but flag any that
     slipped in or have stale `// SAFE:` justifications).
   - `console.log` in `src/` (banned by code standards).
   - `innerHTML` / `outerHTML` / `insertAdjacentHTML` (banned).
   - Inline `element.style.foo = "..."` other than
     `setProperty("--css-var", …)`.
   - Hardcoded hex colors outside `ContributorBrandMarks.ts`.
   - Try/catch swallowing errors silently.
   - `// TODO` / `// FIXME` older than 30 days.
9. **Build-output health** — `main.js` and `styles.css` sizes; flag
   sudden growth (>10% week-over-week).

## Rules

- Cite file paths with line ranges (e.g. `src/main.ts:1840-1912`).
- Distinguish **Confirmed** findings (grep/read evidence) from
  **Hypothesis** findings (pattern-matched but not verified).
- Recommend the smallest unit of action. Prefer **YELLOW: targeted
  cleanup**.
- Do **not** propose architectural refactors — escalate those to the
  Architecture Drift audit by adding them to the report's
  "Escalations" section.
- Do **not** duplicate what `qa-audit.mjs`, `obsidian-compliance.mjs`,
  or `css-audit.mjs` already enforce. If you find a true violation
  those scripts missed, that itself is a finding (the gate needs
  hardening).
- Include a **"Do Nothing / Monitor"** category. Note what would
  change your mind.
- Every recommendation must include: **risk**, **effort**,
  **confidence**, **suggested next action**, and a **category** from:
  `cleanup | stabilization | modernization | doctrine correction | test hardening | no action`.

## Product Doctrine Check

Scan recent diffs (`git log --since="14 days ago" --stat`) and flag any
change that touches:

- Author control (explicit, opt-in, reversible manuscript changes)
- Local-first (no hidden network, telemetry, accounts, or remote
  processing; HTTP only via explicit user action + `requestUrl()`)
- Manuscript safety (no overwrite / loss / silent mutation /
  auto-replacement of manuscript text; safety artifacts must be
  non-destructive and must not become alternate sources of truth)
- Conservative suggestion matching (exact / high-confidence only;
  unmatched, drifted, or ambiguous suggestions stay unresolved rather
  than guessed)
- Bulk action safety (destructive or multi-suggestion actions require
  clear confirmation)
- Contributor transparency (identity, provenance, and source context
  preserved end-to-end)
- Obsidian-native behavior (lifecycle-safe cleanup, no default
  hotkeys, no plugin-name in labels, no discouraged APIs)
- Submission compliance (CODE-STANDARDS §1 + compliance scripts pass)

A doctrine violation auto-promotes the related finding to **ORANGE** or
**RED**.

## Output

Fill the report template. Keep prose tight. Under 800 lines total.
Number findings so the Refactor Board can reference them as
`CH-2026-05-19-#3`.

## OUTPUT FORMAT

Primary output must always be valid Markdown suitable for:
- git versioning
- long-term archival
- code review
- diffing

**HTML rendering for this cadence: DISABLED.** Weekly Codebase Health
is a high-frequency, diff-oriented report — keep it Markdown-only. Do
not emit an HTML version unless this policy is changed in
`docs/engineering/audits/README.md`.
