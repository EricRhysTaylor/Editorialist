**Editorialist turns outside feedback and author notes into controlled revision workflows inside Obsidian.**

It is for writers who get notes from human editors, beta readers, or AI and want to work through those notes without losing control of the manuscript. Editorialist gives the Ed side panel three modes: scene-level review batches, manuscript-wide Editorialisms, and pending edits gathered from author notes or Radial Timeline Inquiry.

The plugin does not rewrite your prose on import. Line edits, memos, author questions, and pending-edit notes stay reviewable until you decide what to do with them. Accepted cuts can be backed up to per-scene cut files, and completed sweeps update revision history, contributor stats, and per-scene progress.

> [!IMPORTANT]
> **Radial Timeline + Editorialist**  
> Editorialist is designed to tightly integrate with [Radial Timeline](Radial-Timeline-Integration.md), creating a synergistic relationship: use RT for manuscript design, planning, project management, and analysis; use Ed for systematic editorial sweeps.

Editorialist can use [Radial Timeline](Radial-Timeline-Integration.md) for active-book scope and scene IDs, but it also works on its own.

<p align="center"><img src="images/panel-side-home.png" alt="The Editorialist review panel: how to use Editorialist, recent reviews, and contributors" width="340"></p>

## What It Helps With

- Turning AI, editor, or beta-reader feedback into reviewable suggestions.
- Walking a revision pass scene by scene instead of managing loose notes.
- Keeping every manuscript change explicit and reversible during the session.
- Tracking reviewer contributions, accepted suggestions, and revision progress.
- Keeping structural guidance separate from line-level edits through Editorialisms.

## Three Panel Modes

<p align="center"><img src="images/ui-side-panel-dropdown-rounded.png" alt="Editorialist mode menu with Review, Pending edits, and Editorialisms" width="653"></p>

| Mode | Use it for |
|---|---|
| **Review** | Traditional Editorialist review batches: scene-level edits such as expand, condense, cut, move, and line edits, plus `%%ai question%%` responses and scene memos. Each scene can carry multiple batches from different manuscript shares or review passes. |
| **Pending edits** | Author pending-edit notes and Radial Timeline Inquiry follow-ups gathered across the active book, then walked scene by scene. |
| **Editorialisms** | Manuscript-wide commentary: structural guidance, theme/arc notes, and general feedback with no line edits. |

## What You Work With

| Object | What you get | When you get it | Where it lives |
|---|---|---|---|
| **Review batch** | The AI's formatted response: line edits, cuts, moves, condenses, expands, and memos | After you send the formatting instructions and manuscript text to an AI, or ask an AI to convert human notes | On your clipboard until you import it |
| **Review block** | The imported part of a review batch for one scene | When you import a review batch through the launcher | Appended to the bottom of each targeted scene note |
| **Editorialism** | A structural checklist or manuscript-level directive set | When a reviewer gives broad guidance that should be worked over time | A separate markdown file under `Editorialist/<Book>/` |
| **Pending edit** | A note-to-self or Inquiry follow-up to review later | When it is written into Radial Timeline / scene revision metadata | Read from the active book and shown in Pending edits mode |

## Core Workflow

1. **Copy the formatting instructions** from the review launcher — they include the [format specification](Importing-Reviews.md) and your book's scene IDs.
2. **Get suggestions.** Paste the instructions into your AI conversation along with the prose. For human feedback, collect your reviewer's notes in any form — a photo of a marked-up page, a document, an email — and have an AI shape them into a batch using the same instructions.
3. **Import the batch** through the launcher; Editorialist appends review blocks to the bottom of the targeted scene notes.
4. **Walk the [guided review sweep](Review-Panel.md)** — accept, reject, rewrite, or defer each suggestion.
5. **Finish.** Per-scene progress, contributor stats, and revision history update as each sweep completes.

## Pages

| Page | What's there |
|---|---|
| [Getting Started](Getting-Started.md) | Commands and your first review sweep |
| [Review Panel](Review-Panel.md) | The main working surface — sessions, the suggestion toolbar, statuses |
| [Pending Edits](Pending-Edits.md) | The active-book queue for author notes and Inquiry follow-ups |
| [Editorialisms Panel](Editorialisms-Panel.md) | Structural guidance documents and the checklist workflow |
| [Importing Reviews](Importing-Reviews.md) | Review batches, review blocks, and Editorialism files |
| [Settings Reference](Settings-Reference.md) | All three settings tabs: Core, Contributors, Configuration |
| [Radial Timeline Integration](Radial-Timeline-Integration.md) | What the companion plugin adds |

## License

Source-available, non-commercial software license. Free for personal, educational, and professional creative work — including manuscripts and other commercial creative output produced with the plugin. Commercial use of the software itself, redistribution, and forks for public distribution require written permission. See [LICENSE](https://github.com/EricRhysTaylor/Editorialist/blob/master/LICENSE) for full terms.
