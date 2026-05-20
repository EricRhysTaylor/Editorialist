# Architecture Drift Report — YYYY-MM-DD

**Cadence:** Weekly
**Audited by:** <agent / human>
**Branch / commit:** `<branch>` @ `<sha>`
**Previous report:** `reports/<prev-date>-architecture-drift.md` (or "none")
**Input reports loaded:** _list any CH-* reports consulted_

---

## Executive summary

_2–4 sentences. What seams are drifting? Anything new since last cycle?_

---

## Architecture map snapshot

A short description (5–15 bullets) of the current boundaries:

- `commands/` — _what's registered, where_
- `controllers/` — _which flows orchestrated_
- `core/` — _pure domain logic, no obsidian imports_
- `models/` — _data shapes in active use_
- `orchestrators/` — _multi-step workflows_
- `services/` — _side-effecting integrations_
- `state/` — _canonical in-memory truth_
- `ui/` — _views, modals, panels_
- `main.ts` — _expected thin wiring layer; note size_

This is **descriptive**, not prescriptive — used as a diff point for
next cycle.

---

## Findings

### AD-YYYY-MM-DD-#N — `<short title>`

- **Status:** Confirmed | Hypothesis
- **Concerns:** state | ownership | boundary | command | orchestration | matching | terminology | fallback | cleanup _(one or more)_
- **Category:** cleanup | stabilization | modernization | doctrine correction | test hardening | no action
- **Severity:** GREEN | YELLOW | ORANGE | RED
- **Confidence:** Low | Medium | High
- **Risk:** _concrete consequence_
- **Effort:** _hours / days / weeks_
- **Evidence:** `path/to/file.ts:L120-L189`, `path/to/other.ts:L45`, …
- **Suggested next action:** _smallest clarifying change_
- **Cycles seen:** _N — auto-promote at 3_

---

## Historical Context

Classify each finding (or each theme, if you've clustered them) against
the audit history under `reports/`. Keep it short — one row per item.

| Finding / Theme | Classification |
|---|---|
| `AD-…` | New / Regressed / Previously resolved, resurfaced / Chronic hotspot / Stable or improving / Intentional debt / Deferred by doctrine |

Notes (optional, only when a classification needs a sentence):

- `AD-…` —

---

## Cross-cycle patterns

| ID | Title | Cycles seen | Current severity | Escalate? |
|---|---|---|---|---|
| | | | | |

---

## Do Nothing / Monitor

- **What it is**
- **Why we're not acting**
- **Trigger to escalate**

---

## Product Doctrine Check

- Author control:
- Local-first:
- Manuscript safety:
- Conservative suggestion matching:
- Bulk action safety:
- Contributor transparency:
- Obsidian-native behavior:
- Submission compliance:

---

## Escalations to Refactor Board

- AD-… — one-line rationale
- AD-… —

---

## Next cycle

- Run on (date):
- Specific seams to re-check:
- If skipping this cadence, why:
