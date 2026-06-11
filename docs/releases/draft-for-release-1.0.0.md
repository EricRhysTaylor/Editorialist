A new Obsidian plugin designed to support robust multi-modal editorial review and refinement using human or AI feedback. Independent of, but designed for helpful workflow synergy with, the Radial Timeline long-form manuscript visualization and management plugin. No built-in AI/LLM API integration at this time — use your own LLM to package feedback and import it into Editorialist for a sequenced, step-by-step progression through edits across scenes and entire manuscripts.

## Major functional surfaces

- **Review launcher** — import a review batch or start a pending-edits review, with a one-click template handoff for your reviewers (human or AI).
- **Review panel** — the main working surface: guided review sweeps where you accept, reject, rewrite, or defer each suggestion, with navigation, filters, and per-suggestion statuses.
- **Editorialisms panel** — structural guidance documents and a checklist workflow for manuscript-wide concerns that don't map to a single line edit.
- **Review import formats** — a documented review block format and Editorialism file format; suggestions are matched conservatively against note content, so nothing lands in the wrong place silently.
- **Pending-edits review** — walk every outstanding edit across an entire book in one sequenced flow.
- **Cut files** — accepted cuts are archived per scene with full attribution, never destroyed; includes a `Backup selection to cut file` command and editor right-click action.
- **Progress and contributor stats** — per-scene review progress, per-contributor acceptance rates, and revision history.
- **Settings** — three tabs (Core, Contributors, Configuration) covering revision progress, scene inventory, cut-file behavior, and the Radial Timeline card.
- **Radial Timeline integration** — optional coupling with the companion plugin for long-form manuscript visualization and management.

## How it behaves

- Local-first: no network requests, no account, no telemetry.
- Notes are only modified when you act — import, apply, clean, or run a confirmed maintenance action.
- Backup export writes contributor and revision metadata only, never manuscript text.

Full documentation in the [wiki](https://github.com/EricRhysTaylor/Editorialist/wiki).
