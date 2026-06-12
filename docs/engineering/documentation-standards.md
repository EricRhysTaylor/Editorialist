# Documentation Standards

These rules apply to public documentation in this repository, especially `README.md` and the wiki sources under `wiki/`.

## Purpose by surface

- `README.md` is the short public entry point: what Editorialist does, how it behaves, commands, license, and links.
- `wiki/` is the user manual: installed behavior, workflows, settings, import formats, and companion-plugin behavior.
- `docs/engineering/` is for maintainer process, implementation notes, audits, and documentation policy.
- GitHub issues and releases are the public record for work requests and completed changes.

## Do

- Describe shipped behavior in clear, factual language.
- Keep each page focused on one job. Link to another page instead of restating the same explanation.
- Let the GitHub Wiki page title serve as the page title. Do not start a wiki page with the same H1.
- Use current product names and command names exactly as they appear in the UI.
- Say when a feature is optional, local-only, destructive, or requires confirmation.
- Keep examples short and directly useful.
- Prefer "does", "uses", "opens", and "writes" over dramatic or promotional wording.
- Keep review object vocabulary consistent: a **review batch** is the AI output copied back into Editorialist, a **review block** is the imported per-scene block appended to a scene note, and an **Editorialism** is a separate structural checklist file under `Editorialist/<Book>/`.

## Do not

- Publish speculative roadmap items, private plans, sequencing, or uncommitted integrations in the README or wiki.
- Repeat the same positioning paragraph across multiple pages.
- Repeat a page title in the first heading or first sentence.
- Overstate reliability with phrases like "at every point", "never fails", or "fully integrated" unless the statement is mechanically true and tested.
- Describe internal coupling, APIs, or implementation details unless the user needs them to operate the plugin.
- Add marketing claims where a specific behavior would be clearer.

## Wiki checklist

Before publishing wiki changes:

1. Confirm the page title is not repeated as an H1.
2. Check whether the first paragraph repeats the Home page or README.
3. Remove roadmap, "planned", "upcoming", or "under consideration" content unless the page is an internal engineering doc.
4. Keep companion-plugin pages focused on what the user gets today and what happens when the companion plugin is absent.
5. Run `rg -n "upcoming|planned|roadmap|under consideration|where .* going|how the coupling" wiki README.md` and review every hit.
