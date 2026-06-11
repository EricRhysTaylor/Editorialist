# Radial Timeline Integration

[Radial Timeline](https://github.com/EricRhysTaylor/Radial-Timeline) is Editorialist's companion plugin for manuscript structure. Editorialist works fully without it — the integration is **optional in both directions** and degrades gracefully at every point — but with both installed, Editorialist becomes book-aware.

## What Radial Timeline adds

| Capability | Without RT | With RT |
|---|---|---|
| Book scope | Whole vault / current note | Scoped to RT's **active book** — panels, inventory, and stats all follow it |
| Scene tracking | Stable note IDs injected by Editorialist, or path-based fallback | RT's **stable scene IDs** — robust across renames and moves, shared with RT exports |
| Pending edits | — | Collects revision notes across every scene of the active book in one sweep |
| Scene inventory | Plain scene list | RT Status glyphs (**T**odo / **W**orking / **C**omplete) and Stage glyphs (**Z**ero / **A**uthor / **H**ouse / **P**ress) per scene |
| Review templates | Generic scene-ID guidance | The template embeds the active book's **real scene-ID list**, and RT manuscript exports carry matching inline IDs — so AI reviewers route suggestions to the right scenes |

## How the coupling works today

The integration is deliberately loose: Editorialist consumes RT, never the reverse, and every touchpoint has a fallback.

1. **Detection** — Editorialist checks whether the `radial-timeline` plugin is enabled (with a manifest scan as fallback). The Core settings tab shows an install card when it's absent.
2. **Active book** — RT's `getActiveBook()` API provides the book ID, title, and source folder. Editorialist uses the source folder to scope its scene inventory and vault operations.
3. **Scene data** — RT's `getSceneData()` API provides the scene list: paths, titles, numbers, and each scene's pending-edits frontmatter. Editorialist filters to actual scenes and builds the pending-edits session from it.
4. **Tracking mode** — with RT present and a book active, suggestion tracking keys off RT's stable scene IDs (`Radial Timeline based` mode in the [Tracking section](Settings-Reference.md#core-tab)). Without RT it falls back through Editorialist's own stable note IDs to path-based tracking.
5. **Shared frontmatter** — the inventory glyphs read the status/stage frontmatter conventions both plugins understand (`status` / `Status` / `scene_status` …, `stage` / `Stage` / `publishingStage` …; values `todo`/`working`/`complete` and `zero`/`author`/`house`/`press`).

### Failure handling

Every RT call returns a typed result instead of erroring. If RT is missing, its API surface is unavailable, no book is active, or no scenes have pending edits, Editorialist reports exactly that state and continues at lower fidelity. No feature hard-depends on RT.

## Where the integration is going

The committed direction (see the [Roadmap](Roadmap.md) for sequencing):

- **Website community editorial feedback system.** A major planned feature: extensive integration with the community editorial feedback system on the Editorialist/Radial Timeline website. Feedback gathered there will flow into Editorialist's review workflow, and the system will work with Radial Timeline as well. This lands after the plugin's feature set settles and it ships in the Obsidian Community directory.
- **Full API integration** between the plugins — a deeper programmatic surface than today's two-call read-only coupling. Deliberately deferred: the current feature set needs to stabilize first.

Under consideration, not committed:

- Writing Editorialist's per-scene revision state *back* to Radial Timeline (two-way sync).
- Event-based refresh instead of reading RT data from disk.
- Surfacing Editorialist polish state inside RT's timeline view.
