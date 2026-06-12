[Radial Timeline](https://github.com/EricRhysTaylor/Radial-Timeline) is a companion plugin for manuscript structure. When it is installed and an active book is set, Editorialist uses that book context for scene inventory, pending-edits review, and scene ID guidance.

The integration is optional. Editorialist works without Radial Timeline by using its own note IDs or, when needed, path-based tracking.

## What Radial Timeline adds

| Capability | Without RT | With RT |
|---|---|---|
| Book scope | Whole vault / current note | Active-book scope for panels, inventory, and stats |
| Scene tracking | Editorialist stable note IDs, or path-based fallback | Radial Timeline scene IDs shared with manuscript exports |
| Pending edits | Current note or available scene set | Revision notes collected across the active book |
| Scene inventory | Plain scene list | Scene status and stage glyphs when matching frontmatter exists |
| Review templates | Generic scene-ID guidance | The template includes the active book's scene IDs |

## Availability

If Radial Timeline is missing, disabled, or has no active book, Editorialist reports that state in the UI and continues with its built-in tracking modes. No Editorialist workflow requires Radial Timeline to be installed.
