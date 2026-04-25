<!-- Logo placeholder — replace src with the Editorialist logo once supplied. -->
<p align="center">
  <img src="https://raw.githubusercontent.com/EricRhysTaylor/Editorialist/master/logo.png" alt="Editorialist Logo" width="10%" style="border-radius: 0;">
</p>
<p align="center" style="font-family: sans-serif; font-weight: 100; font-size: 14px; margin-top: 12px; margin-bottom: 0; letter-spacing: 8px;">
  Editorialist
</p>
<p align="center" style="font-family: sans-serif; font-size: 14px; margin-bottom: 10px;">
  by Eric Rhys Taylor
</p>


<p align="center">
  <a href="https://github.com/EricRhysTaylor/Editorialist/stargazers" target="_blank" rel="noopener"><img src="https://img.shields.io/github/stars/EricRhysTaylor/Editorialist?colorA=363a4f&colorB=e0ac00&style=for-the-badge" alt="GitHub star count"></a>
  <a href="https://obsidian.md/plugins?id=editorialist" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json&query=$.editorialist.downloads&label=Downloads&style=for-the-badge&colorA=363a4f&colorB=d53984" alt="Plugin Downloads"/></a>
  <a href="https://github.com/EricRhysTaylor/Editorialist/blob/master/LICENSE" target="_blank" rel="noopener"><img src="https://img.shields.io/static/v1.svg?style=for-the-badge&label=LICENSE&message=NON-COMMERCIAL%20SOFTWARE%20LICENSE&colorA=363a4f&colorB=b7bdf8" alt="LICENSE — NON-COMMERCIAL SOFTWARE LICENSE"/></a>
  <br/>
  <a href="https://github.com/EricRhysTaylor/Editorialist/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement" target="_blank" rel="noopener"><img src="https://img.shields.io/github/issues/EricRhysTaylor/Editorialist/enhancement?colorA=363a4f&colorB=00bfa5&style=for-the-badge&label=enhancements" alt="Open enhancements on GitHub"></a>
  <a href="https://github.com/EricRhysTaylor/Editorialist/issues?q=is%3Aclosed+label%3Aenhancement" target="_blank" rel="noopener"><img src="https://img.shields.io/github/issues-closed/EricRhysTaylor/Editorialist/enhancement?colorA=363a4f&colorB=4a90e2&style=for-the-badge&label=closed%20enhancements" alt="Closed enhancements on GitHub"></a>
  <a href="https://github.com/EricRhysTaylor/Editorialist/issues?q=is%3Aissue+is%3Aopen+label%3Abug" target="_blank" rel="noopener"><img src="https://img.shields.io/github/issues/EricRhysTaylor/Editorialist/bug?colorA=363a4f&colorB=e93147&style=for-the-badge&label=bugs" alt="Open bugs on GitHub"></a>
</p>

---

## What it does

Editorialist is a local-first editorial review workspace for Obsidian. It imports structured revision notes — from human editors, beta readers, or AI — into the manuscript you are already editing, matches suggestions conservatively against note content, and keeps every manuscript change explicit and author-controlled.

<!-- Screenshot placeholder — drop screenshots into /docs/images and reference them here. -->

---

## How it behaves

- No hidden network requests, no account, no telemetry.
- Notes are only modified when you explicitly import a batch, apply a suggestion, clean review blocks, or run a maintenance action.
- Bulk maintenance actions require confirmation.
- Backup export writes contributor + revision metadata only — never manuscript text.

## Commands

- `Open review launcher` — opens the launcher modal to import a review batch or start pending-edits review.
- `Open review panel` — opens the review side panel for the active note.
- `Review pending edits in active book` — starts the pending-edits review flow across the active book.

Editorialist ships no default hotkeys. Assign your own from Obsidian's hotkey settings.

## License

Source-Available, Non-Commercial Software License. Free for personal,
educational, and professional creative work — including manuscripts and other
commercial creative output produced with the plugin. Commercial use of the
software itself, redistribution, and forks for public distribution require
written permission. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for full terms.
