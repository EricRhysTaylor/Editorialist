# Prompt: Biweekly Obsidian Ecosystem Audit — Editorialist

You are running the **Biweekly Obsidian Ecosystem Audit** for the
Editorialist plugin. Your job is to surface places where the plugin
lags current Obsidian plugin best practices, and to recommend
*modernization opportunities* — not automatic rewrites. You do **not**
modify product code.

Editorialist is going through (or has recently completed) the Obsidian
Community Plugin submission funnel, so this audit doubles as a
submission-readiness check.

## Before you begin

Read:

- `CLAUDE.md` (root)
- `docs/CODE-STANDARDS.md` — especially §1 (Obsidian submission rules)
- `docs/engineering/audits/README.md`
- `manifest.json` (note `id`, `name`, `minAppVersion`, `authorUrl`)
- `versions.json`
- `package.json` (note where `obsidian` lives and its version range)
- `scripts/obsidian-compliance.mjs` — the gate this audit complements

Template:
`docs/engineering/audits/templates/obsidian-ecosystem-report.md`. Save
to `docs/engineering/audits/reports/YYYY-MM-DD-obsidian-ecosystem.md`.

## Web access policy

If your runtime has web access available:

- Consult the latest Obsidian developer documentation at
  <https://docs.obsidian.md/> and the official plugin guidelines at
  <https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines>.
- Cite the source URL and the date you fetched it for every external
  claim.

If your runtime does **not** have web access:

- Do not fabricate URLs or version numbers.
- Base findings only on `node_modules/obsidian/obsidian.d.ts`,
  `manifest.json`, `docs/CODE-STANDARDS.md`, the compliance script,
  and the source tree.
- Mark every finding that *would* benefit from external verification
  with **"requires verification"**.

## Scope and checklist

For each area, cite relevant files/lines and the Obsidian API touched.

1. **Plugin lifecycle** — `onload`/`onunload` symmetry. Confirm **no**
   `workspace.detachLeavesOfType(...)` is called in `onunload()` for
   any registered view type (banned by code standards). Every
   `register*` helper used in `onload` is correctly paired.
2. **Workspace lifecycle** — `ItemView` `getViewType`,
   `getDisplayText`, `getIcon`, `onOpen`/`onClose`. Flag any view that
   mutates external state in `onOpen` without cleanup in `onClose`.
3. **Commands** — `addCommand` with stable `id`s, scoped correctly
   (`editorCallback` vs `callback` vs `checkCallback`), descriptive
   names, **no "Editorialist" prefix** in command names (Obsidian adds
   it), no default hotkeys.
4. **Settings tab** — `PluginSettingTab` structure, `Setting` builder
   usage, persistence via `loadData`/`saveData`, no secrets leaked to
   console, debounced writes on busy controls. No plugin name in
   setting headings.
5. **Editor / CodeMirror** — any direct CM6 usage. Confirm extensions
   are registered via `registerEditorExtension` and disposed correctly.
   Flag direct DOM mutation of the editor surface.
6. **CSS variables** — confirm use of Obsidian theme variables
   (`--background-*`, `--text-*`, `--interactive-*`, `--font-*`).
   Hardcoded hex outside `ContributorBrandMarks.ts` is a violation;
   verify the brand-marks file still carries its trademark
   justification comment.
7. **Mobile compatibility** — `manifest.json` `isDesktopOnly`. If
   false, verify no Node-only APIs (`fs`, `path`, `child_process`)
   leak into product code paths reachable on mobile. Flag heavy
   synchronous work on the main thread.
8. **File operations** — uses of `vault.read`, `vault.modify`,
   `vault.process`, `vault.adapter.*`. Recommend `vault.process` for
   concurrent-safe edits. `adapter.*` is allowed only for files
   outside the Markdown-indexed vault (e.g. another plugin's
   `data.json`) and must carry a justification comment per code
   standards.
9. **Metadata cache** — using `metadataCache` rather than re-parsing
   frontmatter; subscribing to `changed`/`resolve` events
   appropriately.
10. **Network** — every HTTP call uses `requestUrl()` from `obsidian`.
    No network call without explicit user action. No telemetry, no
    analytics, opt-in or otherwise.
11. **Performance** — no blocking work in `onload`, no full-vault
    scans on startup, debounced/throttled event handlers, lazy view
    registration.
12. **Manifest + versions hygiene** —
    - `manifest.json` `id` lowercase, no `obsidian-` prefix.
    - `name` does not contain "Obsidian".
    - `description` ends with a period, ≤ 250 chars.
    - `authorUrl` present.
    - `minAppVersion` reflects a version you actually test against.
    - `versions.json` contains
      `{ [manifest.version]: manifest.minAppVersion }`.
13. **Package hygiene** — `obsidian` in `devDependencies` (not
    `dependencies`), pinned to a range (not `"latest"` or `"*"`).
14. **Release-asset readiness** — `manifest.json`, `main.js`,
    `styles.css` produced cleanly by `npm run build`; tag format is
    bare version (no `v` prefix).

## Rules

- Cite file paths with line ranges and the Obsidian API touched.
- Distinguish **Confirmed** from **Hypothesis** from **Requires
  verification**.
- Each finding includes: **risk**, **effort**, **confidence**,
  **suggested next action**, **category** — for this audit, expect
  mostly `modernization` and occasionally `doctrine correction`.
- Recommend the smallest meaningful upgrade. Do not propose adopting
  every new API just because it exists.
- Do not duplicate `scripts/obsidian-compliance.mjs` checks — if it
  already passes, note that and move on. If you find a real
  violation the script missed, that's a finding (the script needs
  hardening).
- Include a **"Do Nothing / Monitor"** section.

## Product Doctrine Check

Re-evaluate against:

- Author control
- Local-first
- Manuscript safety
- Conservative suggestion matching
- Bulk action safety
- Contributor transparency
- Obsidian-native behavior
- Submission compliance

Native-behavior misses (custom keybindings that fight Obsidian's,
modals that don't respect Esc, settings UI that doesn't match Obsidian
conventions, plugin-name duplication in labels) are auto-promoted to
**ORANGE**.

## Output

Fill the template. Number findings as `OE-YYYY-MM-DD-#N`. Under 800
lines.

## OUTPUT FORMAT

Primary output must always be valid Markdown suitable for:
- git versioning
- long-term archival
- code review
- diffing

**HTML rendering for this cadence: DISABLED by default.** Biweekly
Obsidian Ecosystem reports are routine. If this particular run is
being done as part of a submission-readiness or milestone review (the
human reviewer will say so explicitly in the invocation), follow the
optional HTML guidance in the Monthly Refactor Board prompt.
Otherwise, Markdown only.
