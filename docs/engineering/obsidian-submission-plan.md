# Obsidian Community Plugin Submission Plan — Editorialist

Status snapshot (2026-06-11):

- Repo public at `EricRhysTaylor/Editorialist`; `npm run compliance` passes; 571/571 tests pass.
- **No GitHub releases yet** — a release with `manifest.json`, `main.js`, `styles.css` is a hard requirement.
- manifest/package/versions.json all agree on `0.1.0`, `minAppVersion 1.5.0`.
- No network calls in `src/` (no `requestUrl`/`fetch`); README already states no network/account/telemetry.

## Blockers to fix before submitting

1. **Manifest description contains "Obsidian".** The obsidian-releases validator rejects
   descriptions that mention Obsidian (it's implied). Reword; sync `package.json` and the
   GitHub repo description (currently three different strings).
2. **Broken README logo.** README hotlinks `logo.png` from the repo, but the file doesn't
   exist. Add the logo or drop the placeholder. The Downloads badge will also be dead
   until the plugin is listed — consider removing it until acceptance.
3. **17 baselined obsidianmd lint violations.** `no-static-styles-assignment` ×10
   (EditorialismPanel.ts) and `prefer-window-timers` ×7 (DebouncedSaver, TrailingDebouncer,
   ReviewPanel). The Obsidian review bot flags these same rules — fix and zero the baseline.
4. **License risk.** Custom "Source-Available, Non-Commercial" license. Verify against the
   current submission requirements / developer policies whether this passes review or
   needs to change (e.g. MIT) before submitting.

## Quality pass

5. README reviewer pass — usage docs, screenshots/GIF, install section; keep the
   no-network disclosure.
6. Self-audit against the official checklist (manifest fields, `isDesktopOnly: false` —
   confirm mobile actually works, command naming, onunload rules, fundingUrl decision).
   Cross-check `scripts/obsidian-compliance.mjs` against upstream docs for rule drift.
7. `npm run release:check` fully green after the fixes.

## Release + submission

8. Cut the first GitHub release: bare version tag (`0.1.0`, not `v0.1.0`), exactly three
   assets attached individually — `manifest.json`, `main.js`, `styles.css`. Manifest
   version must equal the tag.
9. Fork `obsidianmd/obsidian-releases`, append to `community-plugins.json`:
   `{ "id": "editorialist", "name": "Editorialist", "author": "RT LLC",
   "description": <final wording>, "repo": "EricRhysTaylor/Editorialist" }`.
   Open PR titled `Add plugin: Editorialist` using their template.
10. Respond to ObsidianReviewBot findings (push fixes to this repo; no new PR needed),
    then human review — typically takes weeks. Plugin goes live on merge.

Task list for this plan is tracked in the Claude Code session task system (tasks #1–#10).
