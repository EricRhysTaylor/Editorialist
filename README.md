# Editorialist

Editorialist is a local-first editorial review workspace for Obsidian. It imports structured revision notes into the manuscript you are already editing, matches suggestions conservatively against note content, and keeps every manuscript change explicit.

## What the plugin does

- Imports formatted review batches into one or more notes.
- Shows pending suggestions in a dedicated review panel.
- Lets you apply, reject, defer, or manually rewrite suggestions one by one.
- Tracks contributor history and review outcomes locally inside plugin data.
- Optionally integrates with Radial Timeline for scene-aware inventory and routing.

## How it behaves

- Editorialist does not make hidden network requests.
- Editorialist does not require an account, payment, cloud service, or telemetry.
- Editorialist only changes note text when you explicitly import review blocks, apply a suggestion, clean imported review blocks, or choose a maintenance action that modifies frontmatter.
- Bulk maintenance actions now require confirmation before they change notes.
- Backup export writes a JSON file to the vault root containing Editorialist metadata only. It does not export manuscript text.

## Current note and frontmatter mutations

Editorialist can modify vault content in these explicit cases:

- Importing a review batch appends an Editorialist review block to the destination note.
- Applying a suggestion edits the active note in the editor.
- Cleaning review blocks removes only Editorialist-imported fenced review blocks.
- Injecting stable note IDs adds an `editorial_id` field to tracked notes that do not already have a stable identifier.
- Recording scene progress may update `editorial.revision` frontmatter for tracked Radial Timeline scenes.

## Getting started

1. Open the command palette and run `Editorialist: Open review launcher`.
2. Paste a formatted review batch into the launcher.
3. Preview the destination notes.
4. Import the batch and review suggestions from the side panel.
5. Apply, reject, defer, or rewrite suggestions explicitly from the panel toolbar.

## Commands

- `Open review launcher` — opens the launcher modal to import a review batch or start pending-edits review.
- `Open review panel` — opens the review side panel for the active note.
- `Review pending edits in active book` — starts the pending-edits review flow across the active book.

Review actions (apply, reject, defer, rewrite, navigate) are performed from the review panel and toolbar UI rather than as separate commands. Editorialist does not ship default hotkeys. Users can assign their own shortcuts from Obsidian settings.

## Development

```bash
npm install
npm run check
npm run build
```

`npm run build` produces the release bundle locally without copying files into a vault or running git backup automation.

If you want to copy the plugin into a dev vault after building:

```bash
export EDITORIALIST_DEV_PLUGIN_DIR="/absolute/path/to/.obsidian/plugins/editorialist"
npm run build:dev
```

## Release checklist

For an Obsidian community-plugin release:

1. Update `manifest.json` version and verify `versions.json` if `minAppVersion` changes.
2. Run `npm run release:check`.
3. Create a GitHub release whose tag matches `manifest.json`.
4. Attach `manifest.json`, `main.js`, and `styles.css` to the release.

`manifest.json` remains at the repository root as required for submission.

## Attribution

No vendored third-party source files were found in this repository during the current release-readiness pass. Dependency licenses are recorded through `package-lock.json`.

## License

MIT. See [LICENSE](LICENSE).
