## Summary

Editorialist 1.0.8 brings the author-query workflow into the day-to-day review loop, folds Editorialisms into the main side panel, adds revision-effort estimates, and strengthens cleanup/recovery for imported review blocks. The wiki is current for this release, including new screenshots for the Editorialisms side-panel mode and right-click cut-file backup.

## New features

- Add author-query insertion from the editor, command palette, and right-click menu, with hidden `%%ai: ...%%` markers preserved for manual review handoff.
- Add author-query Resolve/Dismiss handling so review passes can mark embedded author questions as handled.
- Unify the review and Editorialisms surfaces under one Ed side panel, with a compact mode switch beside the `Editorialist` title.
- Add revision-effort estimates for Editorialisms, backed by configurable drafting/editing assumptions.
- Add panel and rescan commands for finding recoverable review blocks in active manuscript notes.

## Major bugs fixed

- Recover imported review blocks whose headers include `ImportedAt:` before `BatchId` / `ImportedBy`, so cleanup and rescan can see blocks created by the current import flow.
- Heal orphaned review blocks and improve sweep status detection so completed or stale imports do not get stranded in scenes.
- Center and tighten Editorialism status controls in the side panel.

## Documentation and screenshots

- Updated wiki guidance for Radial Timeline integration, manuscript folder scope, import matching, cut-file controls, and settings behavior.
- Published the new release screenshots:
  - ![Editorialisms panel mode](https://raw.githubusercontent.com/wiki/EricRhysTaylor/editorialist/images/panel-side-editorialisms.png)
  - ![Right-click cut-file backup](https://raw.githubusercontent.com/wiki/EricRhysTaylor/editorialist/images/right-click-menu-cut.png)
