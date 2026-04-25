# Claude Code Instructions — Editorialist

## Working directory

Main repo: `/Users/ericrhystaylor/Documents/RT LLC/CodeBase/Editorialist`
Primary branch: `master`

## Code standards

Before writing or refactoring code in this repo, read
[`docs/CODE-STANDARDS.md`](docs/CODE-STANDARDS.md). It codifies the rules we
enforce via the audit scripts, including all Obsidian Community Plugin
submission requirements.

Key rules that are most often violated:

- Never call `workspace.detachLeavesOfType(...)` in `onunload()`.
- Ribbon labels and command names must **not** include "Editorialist" — Obsidian
  adds the plugin name automatically.
- `obsidian` goes in `devDependencies`, never `dependencies`. Never pin to `"latest"`.
- No `innerHTML` / `outerHTML` / `insertAdjacentHTML`. Use `createEl` / `setText`.
- No inline `element.style.foo = ...`. `style.setProperty("--css-var", ...)` is
  the only exception, and only for CSS custom properties.
- Hardcoded hex colors are banned outside `ContributorBrandMarks.ts` (brand logos).
- `any` / `as any` / `@ts-expect-error` need a same-line `// SAFE:` or explanatory
  comment. Otherwise `qa-audit.mjs` fails the build.

## Build / check / release

```bash
npm run dev              # watch build
npm run check            # typecheck + lint + css + qa-audit + compliance
npm run build            # full check + production bundle + copy-to-vault
npm run release:check    # check + tests + css-drift + build
npm run release -- patch # bump, rebuild, print tag/upload instructions
```

The compliance script (`scripts/obsidian-compliance.mjs`) runs on every build
and `check`, so submission blockers are caught before a commit ever lands.

## Release artifacts

GitHub Release assets for an Obsidian release are exactly three files,
attached individually (no zip, no folder): `manifest.json`, `main.js`,
`styles.css`. Tag name is the bare version (e.g. `0.1.1`, not `v0.1.1`).
