## Editorialist 1.0.8

This release turns the Ed side panel into a three-mode revision workspace: Review for scene-level batches, Pending edits for author / Inquiry follow-ups, and Editorialisms for manuscript-wide commentary.

## What's new

### Ask questions in the manuscript

Mark an uncertainty exactly where it appears, then include it in the next review handoff.

Example: insert the syntax anywhere in a scene by typing it, using the side-panel insert button, or running Command-P -> **Insert author query**. The button and command open a dialog and place the marker in the scene, or copy it to the clipboard when you need to paste it:

`%%ai: we have to reveal more about why she buys these presents for the refugees. Either here or somewhere else. Here possibly confuses with the IT subplot.%%`

Later, Resolve or Dismiss the question when the issue is handled.

### Three modes in one Ed panel

The side panel now switches between Review, Pending edits, and Editorialisms without opening a separate tool surface. The top controls keep Toggle modes, Erase batches, Import Batch, Insert AI directed inline comments, Select text and backup to cut file, and Settings close at hand.

Example: work through a batch of line edits, switch to Pending edits to handle author / Inquiry follow-ups, then switch to Editorialisms to check the broader manuscript guidance.

### Revision-effort estimates

Editorialisms now show a rough time estimate based on configurable drafting and editing assumptions.

Example: a structural note that adds two scenes and twenty directives can show whether it is an evening of work or a multi-session revision.

### Scene-aware Editorialism highlights

Editorialism items now light up with a green row accent when they relate to the scene you are working in. Scene and range scopes match by scene number; arc scopes match character, subplot, and action / description metadata.

Example: while working in a scene whose metadata mentions `Cesena`, an item scoped to `[scope:: arc:Cesena thread]` stands out so you can keep that broader arc guidance in view.

### More reliable review progress

Editorialist is better at recognizing review notes it has already added to the manuscript.

Example: when you return to a scene later, the panel is less likely to lose track of what is pending, resolved, or ready to continue.

### Faster cut-file backup

The right-click menu now exposes the cut-file backup path directly.

Example: save a selected paragraph to the scene's cut file before rewriting it, without accepting a formal review suggestion first.

## Fixes

- Review progress is tracked more consistently across imported notes.
- Review notes written by the current import flow are recognized more reliably.
- Editorialism status controls are tighter and better aligned in the panel.

## Screenshots

**Three-mode menu**

<img src="https://raw.githubusercontent.com/wiki/EricRhysTaylor/editorialist/images/release-1-0-8-mode-menu-preview.png" alt="Editorialist mode menu with Review, Pending edits, and Editorialisms">

**Side-panel controls**

<img src="https://raw.githubusercontent.com/wiki/EricRhysTaylor/editorialist/images/release-1-0-8-side-panel-buttons-preview.png" alt="Editorialist side-panel controls for Toggle modes, Erase batches, Import Batch, Insert AI directed inline comments, Select text and backup to cut file, and Settings">

**Editorialisms mode**

<img src="https://raw.githubusercontent.com/wiki/EricRhysTaylor/editorialist/images/release-1-0-8-editorialisms-preview-570.png" alt="Editorialisms mode in the Ed side panel">

**Right-click cut backup**

<img src="https://raw.githubusercontent.com/wiki/EricRhysTaylor/editorialist/images/release-1-0-8-cut-menu-preview-570.png" alt="Right-click menu showing backup selection to cut file">

The wiki has also been refreshed for Radial Timeline integration, manuscript folder scope, import matching, cut-file controls, and settings behavior.
