The second sidebar view. Where the [Review Panel](Review-Panel.md) handles imported review batches inside scene notes, the Editorialisms panel manages **Editorialism documents** — separate structural guidance files that span scenes, arcs, or the whole manuscript.

<!-- Screenshot still needed: Editorialisms panel with a document open (images/panel-editorialisms.png) -->

## What an Editorialism is

An Editorialism is a plain markdown file in your vault — a themed checklist of editorial directives. It is not a review batch and it is not appended to scene notes. Examples of work that belongs here rather than in a review block:

- A development edit's structural agenda ("compress the middle act", "thread the antagonist earlier")
- Design intent and doctrine the manuscript should conform to
- Multi-session checklists you work through over weeks
- Arc-level concerns that touch many scenes

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

Files without `type: editorialism` are ignored. The full file format — section headings, task items, `[scope:: …]` and `[tags:: …]` metadata — is documented in [Importing Reviews § Format B](Importing-Reviews.md#format-b--the-editorialism-file). Reviewers (human or AI) can produce these files directly; the launcher's template includes the format.

**Getting a file into the panel.** The fastest path is the [review launcher](Importing-Reviews.md): paste an AI reply that contains an editorialism file (a ```` ```editorialism ```` fenced block, or just the `type: editorialism` frontmatter) and click **Save editorialism file**. Editorialist writes it to `Editorialist/<Book>/<Title>.md`, creating the folder, and opens this panel. Re-saving the same `title:` overwrites in place. Creating the file by hand works too.

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

Because Editorialisms are plain markdown task lists, they stay fully readable and editable outside the panel — edit the file directly and the panel reflects it. The `[scope:: …]` metadata records which scene, range (`13–22`), arc (`arc:<name>`), or `manuscript` each directive applies to.

## When to use which

| Situation | Use |
|---|---|
| Concrete prose change to a specific passage | [Review batch](Importing-Reviews.md#format-a--the-review-batch) → imported review blocks → Review Panel |
| Commentary on a scene or the batch | `=== MEMO ===` in a review block |
| Directive spanning scenes, arcs, or the whole book | Editorialism file → this panel |
| A reviewer sends both line edits and structural notes | Both formats in one reply — each goes to its own surface |
