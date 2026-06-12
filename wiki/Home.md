# Editorialist

**A local-first editorial review workspace for Obsidian.**

Editorialist imports structured revision notes — from human editors, beta readers, or AI — into the manuscript you are already editing, matches suggestions conservatively against note content, and keeps every manuscript change explicit and author-controlled.

Editorialist is designed to integrate tightly with the [Radial Timeline](Radial-Timeline-Integration.md) companion plugin — scene ID insertion, the upcoming community editorial feedback features, and more — while remaining fully functional on its own. It is a desktop-only plugin.

<p align="center"><img src="images/panel-side-home.png" alt="The Editorialist review panel: how to use Editorialist, recent reviews, and contributors" width="340"></p>

## How it works

Editorialist is a local-only system — it runs entirely inside your vault, with no account or service behind it. You handle the transfer yourself: copy the formatting instructions out to your AI, and bring the formatted response back. Your manuscript changes only when you accept a suggestion, and anything you cut along the way is archived to per-scene [cut files](Settings-Reference.md#configuration-tab) rather than discarded.

## The workflow

1. **Copy the formatting instructions** from the review launcher — they include the [format specification](Importing-Reviews.md) and your book's scene IDs.
2. **Get suggestions.** Paste the instructions into your AI conversation along with the prose. For human feedback, collect your reviewer's notes in any form — a photo of a marked-up page, a document, an email — and have an AI shape them into a batch using the same instructions.
3. **Import the batch** through the launcher; the suggestions land in the targeted scenes as review blocks.
4. **Walk the [guided review sweep](Review-Panel.md)** — accept, reject, rewrite, or defer each suggestion.
5. **Finish.** Per-scene progress, contributor stats, and revision history update as each sweep completes.

## Pages

| Page | What's there |
|---|---|
| [Getting Started](Getting-Started.md) | Install, commands, and your first review sweep |
| [Review Panel](Review-Panel.md) | The main working surface — sessions, the suggestion toolbar, statuses |
| [Editorialisms Panel](Editorialisms-Panel.md) | Structural guidance documents and the checklist workflow |
| [Importing Reviews](Importing-Reviews.md) | The block format and Editorialism file format — what your AI produces and the launcher imports |
| [Settings Reference](Settings-Reference.md) | All three settings tabs: Core, Contributors, Configuration |
| [Radial Timeline Integration](Radial-Timeline-Integration.md) | What the companion plugin adds, how the coupling works, where it's heading |
| [Roadmap](Roadmap.md) | What's planned, in rough order |

## License

Source-available, non-commercial software license. Free for personal, educational, and professional creative work — including manuscripts and other commercial creative output produced with the plugin. Commercial use of the software itself, redistribution, and forks for public distribution require written permission. See [LICENSE](https://github.com/EricRhysTaylor/Editorialist/blob/master/LICENSE) for full terms.
