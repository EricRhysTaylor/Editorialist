[Radial Timeline](https://github.com/EricRhysTaylor/Radial-Timeline) is a companion plugin for manuscript structure. When it is installed and an active book is set, Editorialist uses that book context for scene inventory, pending-edits review, and scene ID guidance.

The integration is optional. Editorialist works without Radial Timeline by using a configured manuscript folder, its own note IDs, or path-based tracking when needed.

## What Radial Timeline adds

| Capability | Without RT | With RT |
|---|---|---|
| Book scope | Configured manuscript folder, active-note folder, or whole vault | Active-book scope for panels, inventory, and stats |
| Scene tracking | Editorialist stable note IDs, or path-based fallback | Radial Timeline scene IDs shared with manuscript exports |
| Pending edits | Active-book pending-edits sweep is not available | Revision notes collected across the active book |
| Scene inventory | Plain scene list | Scene status and stage glyphs when matching frontmatter exists |
| Review templates | Scene IDs from scoped notes when available; otherwise generic guidance | The template includes the active book's scene IDs |

## Availability

If Radial Timeline is missing, disabled, or has no active book, Editorialist reports that state for pending-edits review and continues with its built-in import and tracking modes. Imported review batches do not require Radial Timeline.
