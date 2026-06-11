# The Editorialisms Panel

The second sidebar view. Where the [Review Panel](Review-Panel.md) handles line-level suggestions inside scenes, the Editorialisms panel manages **Editorialism documents** — structural guidance that spans scenes, arcs, or the whole manuscript.

<!-- Screenshot placeholder: Editorialisms panel with a document open (images/) -->

## What an Editorialism is

An Editorialism is a plain markdown file in your vault — a themed checklist of editorial directives. Examples of work that belongs here rather than in a review block:

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

## The panel

- **Header** — the active book label and sync status.
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
| Concrete prose change to a specific passage | [Review block](Importing-Reviews.md#format-a--the-review-block) → Review Panel |
| Commentary on a scene or the batch | `=== MEMO ===` in a review block |
| Directive spanning scenes, arcs, or the whole book | Editorialism file → this panel |
| A reviewer sends both line edits and structural notes | Both formats in one reply — each goes to its own surface |
