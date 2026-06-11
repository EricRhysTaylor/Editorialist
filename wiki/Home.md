# Editorialist

**A local-first editorial review workspace for Obsidian.**

Editorialist imports structured revision notes — from human editors, beta readers, or AI — into the manuscript you are already editing, matches suggestions conservatively against note content, and keeps every manuscript change explicit and author-controlled.

<!-- Screenshot placeholder: review session in progress (images/) -->

## How it behaves

These are commitments, not defaults:

- **No hidden network requests, no account, no telemetry.** Everything runs in your vault.
- **Notes are only modified when you act.** Importing a batch, applying a suggestion, cleaning review blocks, or running a maintenance action — nothing else writes to your manuscript.
- **Bulk maintenance actions require confirmation.**
- **Backup export writes contributor + revision metadata only — never manuscript text.**
- **Cut text is archived, not destroyed.** Accepted cuts can be preserved in per-scene [cut files](Settings-Reference.md#configuration-tab) with full attribution.

## The workflow in one paragraph

You (or the review launcher's template button) hand a reviewer the [format specification](Importing-Reviews.md); they return suggestions as a review block or an Editorialism file; you import the batch through the launcher; then you walk the suggestions in a [guided review sweep](Review-Panel.md) — accepting, rejecting, rewriting, or deferring each one — while Editorialist tracks per-scene progress, per-contributor acceptance stats, and revision history.

## Pages

| Page | What's there |
|---|---|
| [Getting Started](Getting-Started.md) | Install, commands, and your first review sweep |
| [Review Panel](Review-Panel.md) | The main working surface — sessions, the suggestion toolbar, statuses |
| [Editorialisms Panel](Editorialisms-Panel.md) | Structural guidance documents and the checklist workflow |
| [Importing Reviews](Importing-Reviews.md) | The block format and Editorialism file format — the page to give your reviewers |
| [Settings Reference](Settings-Reference.md) | All three settings tabs: Core, Contributors, Configuration |
| [Radial Timeline Integration](Radial-Timeline-Integration.md) | What the companion plugin adds, how the coupling works, where it's heading |
| [Roadmap](Roadmap.md) | What's planned, in rough order |

## License

Source-available, non-commercial software license. Free for personal, educational, and professional creative work — including manuscripts and other commercial creative output produced with the plugin. Commercial use of the software itself, redistribution, and forks for public distribution require written permission. See [LICENSE](https://github.com/EricRhysTaylor/Editorialist/blob/master/LICENSE) for full terms.
