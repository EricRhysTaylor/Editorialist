Editorialisms is the manuscript-wide commentary mode. Where [Review](Review-Panel) handles scene-level batches with line edits and [Pending Edits](Pending-Edits) handles author / Inquiry follow-ups, Editorialisms manages **Editorialism documents** — separate structural guidance files that span scenes, subplots, or the whole manuscript. It is for general feedback, not line edits.

<!-- Screenshot still needed: Editorialisms panel with a document open (images/panel-editorialisms.png) -->

## What an Editorialism is

An Editorialism is a plain markdown file in your vault — a themed checklist of editorial directives. It is not a review batch and it is not appended to scene notes. Examples of work that belongs here rather than in a review block:

- A development edit's structural agenda ("compress the middle act", "thread the antagonist earlier")
- Design intent and doctrine the manuscript should conform to
- Multi-session checklists you work through over weeks
- Subplot-level concerns that touch many scenes

Editorialism files live under `Editorialist/<Book>/<Title>.md` and are recognized by their frontmatter:

```yaml
---
type: editorialism
title: Middle-act compression
book: <must match the active book label exactly>
status: in-progress
created: 2026-06-10
---
```

Files without `type: editorialism` are ignored. The full file format — section headings, task items, `[scope:: …]` and `[tags:: …]` metadata — is documented in [Importing Reviews § Format B](Importing-Reviews#format-b--the-editorialism-file). Reviewers (human or AI) can produce these files directly; the launcher's template includes the format.

**Getting a file into the panel.** The fastest path is the [review launcher](Importing-Reviews): paste an AI reply that contains an editorialism file (a ```` ```editorialism ```` fenced block, or just the `type: editorialism` frontmatter) and click **Save editorialism file**. Editorialist writes it to `Editorialist/<Book>/<Title>.md`, creating the folder, and opens this panel. Re-saving the same `title:` overwrites in place. Creating the file by hand works too.

> Only files whose `book:` matches the active book label appear while that book is active. If a saved file doesn't show up, check that its `book:` value matches exactly.

## The panel

- **Header** — the active book label (or "No active book selected").
- **Document list** — every Editorialism for the active book, each showing its completion (done items / total items).
- **Detail view** — select a document to see its items grouped by section.

### Working items

Each item is a task line with a five-state status. Clicking an item's status cycles it:

```
[ ] open → [/] in progress → [x] done → [-] deferred → [?] question
```

Because Editorialisms are plain markdown task lists, they stay fully readable and editable outside the panel — edit the file directly and the panel reflects it. The `[scope:: …]` metadata records which scene, range (`13–22`), subplot (`subplot:<name>`), or `manuscript` each directive applies to.

### Current-scene highlights

When you are working in a scene, Editorialist marks related Editorialism items with a green left accent. This helps you spot broad guidance that matters to the scene in front of you, without rereading the whole agenda.

<p align="center"><img src="images/panel-side-editorialism-active-rounded.png" alt="Editorialism item with a green current-scene accent for the Cesena thread" width="655"></p>

Rows light up when their `[scope:: …]` matches the current scene:

- A scene scope matches that scene number.
- A range scope matches when the current scene falls inside the range.
- A subplot scope matches when the subplot name overlaps the scene's character, subplot, or action / description frontmatter. For example, an item scoped to `[scope:: subplot:Cesena thread]` lights up while you are in a scene whose metadata mentions `Cesena`.

## When to use which

| Situation | Use |
|---|---|
| Concrete prose change to a specific passage | [Review batch](Importing-Reviews#format-a--the-review-batch) → imported review blocks → Review Panel |
| Commentary on a scene or the batch | `=== MEMO ===` in a review block |
| Directive spanning scenes, subplots, or the whole book | Editorialism file → this panel |
| Author note or Radial Timeline Inquiry follow-up | [Pending Edits](Pending-Edits) |
| A reviewer sends both line edits and structural notes | Both formats in one reply — each goes to its own surface |
