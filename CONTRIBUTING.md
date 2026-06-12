# Contributing to Editorialist

Thanks for your interest in Editorialist. Here's how to help effectively.

## Bugs and feature requests

Open an issue at
[github.com/EricRhysTaylor/Editorialist/issues](https://github.com/EricRhysTaylor/Editorialist/issues).

- **Bugs:** include your Obsidian version, Editorialist version, platform, and
  the steps to reproduce. If the problem involves a review block or
  Editorialism file, a minimal sample (with any manuscript text replaced by
  placeholder text) makes fixes dramatically faster.
- **Feature requests:** describe the editorial workflow you're trying to
  accomplish, not just the mechanism. Existing public requests are tracked in
  GitHub issues.

## Pull requests

Editorialist is source-available under a non-commercial license (see
[LICENSE](LICENSE)), and the codebase is held to strict quality gates
([docs/CODE-STANDARDS.md](docs/CODE-STANDARDS.md)).

**Please open an issue to discuss any change before submitting a pull
request.** Unsolicited PRs may be declined regardless of quality if they don't
fit the roadmap. Per the license's contribution terms, submitted contributions
may be used, modified, or incorporated into the plugin without obligation.

If a change is agreed:

1. `npm install`, then `npm run dev` for a watch build.
2. `npm run check && npm run test` must pass before review (typecheck, lint,
   CSS audits, Obsidian compliance, 570+ unit tests).
3. Match the existing code style; UI text uses sentence case.

## Documentation

Wiki improvements are welcome — the wiki sources live in this repo under
[`wiki/`](wiki/). Suggest changes via an issue or discussion rather than
editing the GitHub wiki directly, since it is published from this folder. For
tone, scope, and public/private boundaries, follow
[docs/engineering/documentation-standards.md](docs/engineering/documentation-standards.md).
