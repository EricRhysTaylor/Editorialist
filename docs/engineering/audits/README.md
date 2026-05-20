# Editorialist Audit System

A lightweight, recurring audit framework for preventing architectural drift,
stale Obsidian practices, and refactor debt in the Editorialist plugin.
Reports are written for human review — they recommend, they do not modify
product code.

> This framework is intentionally aligned with the Radial Timeline audit
> system (`../../../../radial-timeline/docs/engineering/audits/`) so the same
> doctrine, severity scale, longitudinal-memory taxonomy, and output-format
> policy apply across both projects. The **product doctrine pillars** here
> are Editorialist-specific (see below).

---

## Audit tracks

| Track | Cadence | Prompt | Template |
|---|---|---|---|
| Codebase Health | Weekly | [prompts/weekly-codebase-health-audit.md](prompts/weekly-codebase-health-audit.md) | [templates/codebase-health-report.md](templates/codebase-health-report.md) |
| Architecture Drift | Weekly | [prompts/weekly-architecture-drift-audit.md](prompts/weekly-architecture-drift-audit.md) | [templates/architecture-drift-report.md](templates/architecture-drift-report.md) |
| Obsidian Ecosystem | Biweekly | [prompts/biweekly-obsidian-ecosystem-audit.md](prompts/biweekly-obsidian-ecosystem-audit.md) | [templates/obsidian-ecosystem-report.md](templates/obsidian-ecosystem-report.md) |
| Refactor Board | Monthly | [prompts/monthly-refactor-board.md](prompts/monthly-refactor-board.md) | [templates/refactor-board-report.md](templates/refactor-board-report.md) |

---

## How to run an audit (manual)

1. Pick the track and open its prompt file under `prompts/`.
2. Paste the full prompt into an IDE agent (Claude Code, Cursor, etc.) at the
   repo root.
3. The agent inspects the codebase, cites files and line numbers, and
   produces a report.
4. Save the report under `reports/` using the filename convention
   `YYYY-MM-DD-<track>.md` (e.g. `2026-05-19-codebase-health.md`).
5. Review with a human. Do not auto-apply any recommendation.

The `package.json` audit shortcuts simply echo the prompt path:

```
npm run audit:codebase
npm run audit:architecture
npm run audit:obsidian
npm run audit:refactor-board
```

These scripts intentionally do not run analysis themselves — they exist as
mnemonic entry points.

---

## Output format policy

**Markdown is canonical, always.** Every report is authored in Markdown
and committed under `reports/`. Markdown is what gets diffed, reviewed,
and archived.

**HTML rendering is a presentation layer, not a source.** It exists for
reports that are worth making archival-beautiful — never for routine
cycles. Authoring HTML by hand or generating HTML *instead of* Markdown
is out of scope.

| Cadence | Markdown | HTML rendering |
|---|---|---|
| Weekly Codebase Health | Required | Disabled |
| Weekly Architecture Drift | Required | Disabled |
| Biweekly Obsidian Ecosystem | Required | Disabled (enable per-run for milestone / submission reviews) |
| Monthly Refactor Board | Required | Optional |
| Milestone / submission readiness / annual *State of the Codebase* | Required | Recommended |

The HTML style is **restrained, print-friendly, archival engineering
memo** — single file, inline CSS, no JS, no external assets, no
frameworks, dark/light compatible, typography-first. It should feel like
an internal Apple engineering review, not a SaaS analytics dashboard.
No dashboards, no charts (unless explicitly requested), no animated
widgets, no AI-insight cards, no gradient hero sections. Full HTML
constraints live in the Monthly Refactor Board prompt — other prompts
reference them when they opt in.

To change a track's HTML policy, update the table above **and** update
the OUTPUT FORMAT block in the relevant prompt. Don't change one without
the other.

---

## Longitudinal memory — the "Historical Context" section

Every report template carries a short **Historical Context** section
that classifies each finding (or theme) against the audit archive in
`reports/`. The taxonomy is fixed:

- **New** — first appearance.
- **Regressed** — previously resolved, now back.
- **Previously resolved, resurfaced** — same root cause as an old issue,
  different surface.
- **Chronic hotspot** — present across three or more cycles.
- **Stable or improving** — trending the right way; included so we
  notice and stop fussing.
- **Intentional debt** — a known shortcut, accepted by doctrine or
  schedule.
- **Deferred by doctrine** — a refactor we *chose not to do* and the
  Refactor Board already adjudicated it.

The point isn't bookkeeping. Isolated audits are snapshots; engineering
wisdom comes from trend recognition. After 6–12 months of these reports
the archive answers questions a single snapshot cannot:

- Which systems repeatedly drift?
- Which refactors actually worked?
- Which "urgent" issues were noise?
- Where does churn keep happening?
- Which doctrines survived pressure?

Keep the section short. One row per finding. Notes only when a
classification needs a sentence of justification.

---

## Cadence

- **Weekly (Mondays):** Codebase Health + Architecture Drift.
- **Biweekly (every other Friday):** Obsidian Ecosystem.
- **Monthly (first weekday):** Refactor Board, synthesizing the prior month
  of weekly/biweekly reports.

Skip a cycle when there has been no meaningful product change since the last
report — record the skip in the previous report's "Next cycle" section so the
gap is intentional, not forgotten.

---

## Doctrine the audits enforce

Every recurring audit must read and respect:

- `CLAUDE.md` (root) — repo-level conventions and most-violated rules.
- `docs/CODE-STANDARDS.md` — the single source of truth for Obsidian
  submission rules, DOM/TypeScript hygiene, CSS rules, and release process.
- `scripts/qa-audit.mjs`, `scripts/obsidian-compliance.mjs`,
  `scripts/css-audit.mjs`, `scripts/css-drift-check.mjs` — the
  mechanical checks already enforced on every build. Audits should
  *complement*, not duplicate, these gates.

Refactor recommendations must **reduce** complexity and remove fallback
logic, not layer new abstractions. When in doubt, recommend **Monitor**
rather than refactor.

---

## Severity scale (used by Refactor Board)

| Severity | Meaning | Default action |
|---|---|---|
| **GREEN** | Healthy. No action. | Do nothing. |
| **YELLOW** | Localized issue. | Targeted cleanup in a single PR. |
| **ORANGE** | Multi-file drift. | Schedule a short stabilization sprint. |
| **RED** | Doctrine violation or actively blocking feature work. | Refactor before more feature work. |

Each recommendation also carries a **confidence** rating (Low / Medium /
High) and an **evidence** section. Low-confidence findings stay as Monitor
until a second audit confirms them.

---

## Product Doctrine Check (Editorialist-specific)

Every audit must include a "Product Doctrine Check" section evaluating the
changes against the following Editorialist pillars. These are written to be
**testable** — each one gives audit agents a yardstick, not a vibe.

1. **Author control** — every manuscript change is explicit, opt-in, and
   reversible.
2. **Local-first** — no hidden network calls, telemetry, accounts, or
   remote processing. HTTP access only through explicit user action and
   Obsidian-approved `requestUrl()` paths.
3. **Manuscript safety** — never overwrite, lose, silently mutate, or
   auto-replace manuscript text. Safety artifacts must be non-destructive
   and must not become alternate manuscript sources of truth.
4. **Conservative suggestion matching** — exact and high-confidence
   matching only. Unmatched, drifted, or ambiguous suggestions remain
   unresolved rather than guessed.
5. **Bulk action safety** — destructive or multi-suggestion actions
   require clear confirmation and must preserve user trust.
6. **Contributor transparency** — contributor identity, provenance, and
   source context must be preserved end-to-end.
7. **Obsidian-native behavior** — follow Obsidian plugin conventions:
   lifecycle-safe cleanup, no default hotkeys, no duplicated plugin-name
   labels, no discouraged APIs in release paths.
8. **Submission compliance** — `docs/CODE-STANDARDS.md` §1 and compliance
   scripts must pass before release-oriented work is treated as complete.

Any change that violates one of these is automatically **ORANGE or higher**
regardless of size.

---

## What stays manual vs. what could be automated later

**Stay manual (judgment required):**

- Severity assignment (GREEN / YELLOW / ORANGE / RED).
- "Refactor vs Monitor vs Do Nothing" decisions.
- Product Doctrine Check.
- Obsidian Ecosystem modernization choices.

**Already automated (don't duplicate in audits):**

- DOM / TypeScript hygiene → `scripts/qa-audit.mjs`
- Obsidian submission rules → `scripts/obsidian-compliance.mjs`
- CSS hygiene + drift → `scripts/css-audit.mjs`, `scripts/css-drift-check.mjs`

The audits should reference these gates' output but not re-implement
them. Where they overlap, the audit's job is *trend* and *root cause*,
not pass/fail.

**Could later be automated (mechanical signals not yet covered):**

- File-size / function-length thresholds.
- Dead exports.
- Duplicate utility detection (jscpd or similar).
- Command-registration drift (grep + schema).

A future `audit:weekly` GitHub Action could run the mechanical checks
nightly and post a Markdown summary to a draft issue, leaving the human
judgment steps (severity, doctrine, refactor decision) for the weekly
review. Do not build this until the manual cadence has produced at least
four reports of each track — pattern first, automation second.
