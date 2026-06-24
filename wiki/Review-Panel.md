The Review mode is traditional Editorialist: scene-level review batches with line edits, cut / move / condense / expand suggestions, `%%ai question%%` responses, and memos for a scene. Open it with the **Open review panel** command or choose **Review** from the mode menu.

## Idle state

<p align="center"><img src="images/panel-side-home.png" alt="Review panel idle state: imported review pass, pending edits sweep, contributor directory, recent reviews, contributors" width="340"></p>

Between sessions the panel shows:

- **Active book** — which book Editorialist is currently scoped to (via [Radial Timeline](Radial-Timeline-Integration.md) when installed).
- **Pending workflow cards** — imported batches and pending edits waiting for review, each with a start button.
- **Recent activity** — the latest decisions and completed sweeps.
- **Contributors** — a compact view of who has been suggesting what.
- **Onboarding** — a collapsible getting-started disclosure for new vaults.

### Panel controls

<p align="center"><img src="images/ui-side-panel-buttons-rounded.png" alt="Editorialist side-panel controls: toggle modes, erase batches, import batch, insert AI directed inline comments, select text and back up to a cut file, and settings" width="653"></p>

The header controls keep the most common actions close to the review panel:

| Control | What it does |
|---|---|
| **Toggle modes** | Switch between Review, [Pending edits](Pending-Edits.md), and [Editorialisms](Editorialisms-Panel.md). |
| **Erase batches** | Remove imported review batches after you are done with them. |
| **Import Batch** | Paste in a formatted review batch and route it into matching scenes. |
| **Insert AI directed inline comments** | Add a hidden inline question for the next review pass. |
| **Select text and backup to cut file** | Copy selected manuscript text into the scene's cut file. |
| **Settings** | Open Editorialist settings. |

## Review sessions

Starting a workflow card (or importing a review batch) begins a **guided review sweep**. The imported batch has already been split into review blocks at the bottom of the targeted scene notes; the panel reads those blocks and walks their suggestions scene by scene. A scene can hold multiple batches from different manuscript shares or review passes.

<p align="center"><img src="images/panel-side-progressing.png" alt="Review panel during a sweep: next-in-sweep card with unresolved and resolved counts, start scene button, recent reviews" width="340"></p>

### Navigation and filters

- **Previous / next** moves through suggestions; the sweep hands off to the next scene when the current one is resolved.
- **Jump to** — each suggestion card has a jump menu: jump to the suggested text in the editor, to its source review block, or (for a move) to the destination anchor.
- **Contributor filter** — appears only when a session contains suggestions from **more than one contributor**. A dropdown limits the view to one contributor, and a star button shows only [starred contributors](Settings-Reference.md#contributors-tab). With a single-reviewer batch the row stays hidden.
- **Collapse controls** — fold away processed suggestions, pending edits, and comments to reduce noise.

### The suggestion toolbar

<p align="center"><img src="images/toolbar.png" alt="Inline suggestion toolbar over highlighted manuscript text, with the matching review card selected in the side panel" width="720"></p>

Each highlighted suggestion gets an inline toolbar in the editor:

| Action | Trigger | Effect |
|---|---|---|
| **Apply** (Edit / Cut / Condense / Expand / Move) | Click | Apply this suggestion to the prose |
| **Apply and advance** | Shift + click | Apply, then jump to the next suggestion |
| **Apply to all** | Shift + Cmd + click | Apply every applicable suggestion of this kind |
| **Defer** | Click | Skip for now; the sweep can finish later |
| **Rewrite myself** | Click | Take the suggestion as a prompt and write your own version |
| **Backup to cut file** | Click | Archive the target text to the [cut file](Settings-Reference.md#configuration-tab) before deciding |
| **Open cut file** | Shift + click Backup to cut file | Open the scene's cut file |
| **Reject** | Click | Decline the suggestion |
| **Hide toolbar** | Click | Dismiss the overlay without deciding |

### Cut-file preview

<p align="center"><img src="images/panel-side-cut.png" alt="Cut file opened in the side pane after backing up selected manuscript text" width="720"></p>

When you use **Backup to cut file**, Editorialist writes the selected passage to the scene's cut file before you decide what to do with the suggestion. The cut file keeps the archived text with source metadata, while the review suggestion stays active until you accept, reject, rewrite, or defer it.

### Suggestion statuses

Every suggestion moves through an explicit lifecycle:

```
pending ──→ accepted
       ──→ rejected
       ──→ rewritten   (you applied your own version)
       ──→ deferred    (decide later; blocks sweep completion until resolved)
       ──→ unresolved  (couldn't be matched or needs attention)
```

Decisions are undoable during the session. Suggestions whose target text can't be found in the note (paraphrased targets, already-applied edits) are flagged by match type — exact, multiple matches, not found, or already applied — so nothing is ever applied against the wrong text.

### Sweep completion

A sweep finishes only when every suggestion in the batch has a resolved status (accepted, rejected, or rewritten). If pending, unresolved, or deferred items remain, Editorialist pauses and tells you what's left. On completion, the batch is recorded: per-scene polish frontmatter (`Editorialist.revision`, `Editorialist.revision_updated`), contributor acceptance stats, and the activity history all update.

## Pending-edits review

Pending edits now have their own [Pending Edits](Pending-Edits.md) mode. The Review panel still points to that queue when the active book or current scene has pending author notes or Radial Timeline Inquiry follow-ups.
