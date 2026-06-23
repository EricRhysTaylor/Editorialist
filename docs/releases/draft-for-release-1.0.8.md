## Editorialist 1.0.8

This release makes Editorialist easier to use during an actual revision pass: questions can live beside the prose, structural Editorialisms sit in the main Ed panel, and cleanup is better at finding imported notes that were already written into scenes.

## What's new

### Ask questions in the manuscript

Mark an uncertainty exactly where it appears, then include it in the next review handoff.

Example: highlight a paragraph and add `Should this flashback move earlier?` before sending the scene out for feedback. Later, Resolve or Dismiss the question when the issue is handled.

### One Ed panel for edits and Editorialisms

The side panel now switches between review work and Editorialisms without opening a second tool surface.

Example: work through line edits, switch to the Editorialisms mode, then check whether the same scene also serves a larger structural note.

### Revision-effort estimates

Editorialisms now show a rough time estimate based on configurable drafting and editing assumptions.

Example: a structural note that adds two scenes and twenty directives can show whether it is an evening of work or a multi-session revision.

### Better recovery and cleanup

New rescan and cleanup handling finds imported review blocks more reliably, including blocks with newer `ImportedAt:` metadata.

Example: if a sweep looks finished but old review blocks are still sitting in scenes, rescan can recover them instead of leaving the manuscript in a half-clean state.

### Faster cut-file backup

The right-click menu now exposes the cut-file backup path directly.

Example: save a selected paragraph to the scene's cut file before rewriting it, without accepting a formal review suggestion first.

## Fixes

- Imported blocks with `ImportedAt:` metadata are now detected correctly.
- Orphaned review blocks are easier to recover and clean.
- Editorialism status controls are tighter and better aligned in the panel.

## Screenshots

| Editorialisms mode | Right-click cut backup |
|---|---|
| <img src="https://raw.githubusercontent.com/wiki/EricRhysTaylor/editorialist/images/release-1-0-8-editorialisms-preview.png" alt="Editorialisms mode in the Ed side panel" width="360"> | <img src="https://raw.githubusercontent.com/wiki/EricRhysTaylor/editorialist/images/release-1-0-8-cut-menu-preview.png" alt="Right-click menu showing backup selection to cut file" width="360"> |

The wiki has also been refreshed for Radial Timeline integration, manuscript folder scope, import matching, cut-file controls, and settings behavior.
