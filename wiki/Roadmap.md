# Roadmap

Rough order of work. Dates are deliberately absent — sequencing matters more than schedule. (Last updated 2026-06-10.)

## Now: settle the feature set

The current focus is stabilizing what exists rather than adding surface area. Known in-code follow-ups:

- **Normalized matching fallback** (Phase 2) — today suggestion targets match by exact text only; a normalized fuzzy fallback is planned once the exact path is proven (`MatchEngine`).
- **Rewrite capture** — deferred release-candidate follow-up (`main.ts`).
- General polish, documentation (this wiki), and hardening guided by the engineering audit cadence in `docs/engineering/audits/`.

## Next: Obsidian Community Plugins submission

Once the feature set has settled, submit Editorialist to the Obsidian Community Plugins directory. The compliance tooling (`scripts/obsidian-compliance.mjs`, run on every build) is already in place to keep submission blockers out of the codebase.

## Later: full API integration

Full API integration is planned — **but not for a while**. It deliberately waits until after the feature set settles and the plugin ships in the Obsidian Community directory, so the API surface stabilizes against a settled feature set rather than a moving one.

## Major: Website community editorial feedback system

A major planned feature: extensive integration with the **community editorial feedback system on the website**. Community editorial feedback gathered there will connect into Editorialist's import/review workflow, and the system will also work with **Radial Timeline**. See [Radial Timeline Integration](Radial-Timeline-Integration.md) for how the plugins couple today.

## Under consideration (not committed)

- Two-way Radial Timeline sync — writing Editorialist's per-scene revision state back to RT.
- Event-based RT refresh instead of disk reads.
- Surfacing Editorialist polish state inside RT's timeline view.

---

*Feature requests and bug reports: [GitHub issues](https://github.com/EricRhysTaylor/Editorialist/issues).*
