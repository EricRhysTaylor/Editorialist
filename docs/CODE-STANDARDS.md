# Editorialist Code Standards

This document captures rules we enforce in the Editorialist repository. Most
rules are machine-checked; deviations need a same-line `// SAFE:` comment
explaining the exception.

Enforcement scripts live in `/scripts`:

- `qa-audit.mjs` — general DOM / TypeScript hygiene (innerHTML, `any`, style
  attributes, SVG creation, etc.).
- `obsidian-compliance.mjs` — Obsidian Community Plugin submission rules
  (manifest validity, forbidden plugin patterns).
- `css-audit.mjs` / `css-drift-check.mjs` — CSS hygiene and drift.

All three run during `npm run check`, `npm run build`, and
`npm run release:check`, so violations block a build.

---

## 1. Obsidian submission rules

These rules come from the official Obsidian guidelines
(<https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines>) and from
patterns that the review team regularly flags on submission PRs. Breaking any
of these is a build failure.

### 1.1 `manifest.json`

- `id` must be lowercase, alphanumeric + hyphens, no `obsidian-` prefix.
- `name` must not contain the word "Obsidian".
- `description` must end in a period and stay under ~250 characters.
- `authorUrl` is required. The submission bot looks for it.
- `minAppVersion` must reflect a version you actually test against. Do not
  leave it at `0.15.0` just because the sample plugin does.
- `versions.json` must contain `{ [manifest.version]: manifest.minAppVersion }`.

### 1.2 `package.json`

- `obsidian` must be in `devDependencies`, never `dependencies`.
- Pin `obsidian` to a range, never `"latest"` or `"*"`.

### 1.3 Plugin lifecycle

- **Never call `workspace.detachLeavesOfType(...)` in `onunload()`** for a view
  type you registered. Obsidian restores workspace state on reload, and
  `registerView()` already handles cleanup. Detaching here wipes the user's
  open panels.
- Use `this.register*` helpers (`registerEvent`, `registerDomEvent`,
  `registerInterval`, `register`) so Obsidian guarantees cleanup. If you must
  use a raw `addEventListener`, wire the teardown into `onunload()`.
- Do not monkey-patch internal Obsidian methods.
- Do not ship default hotkeys for commands.

### 1.4 Labels and commands

- Ribbon icon labels, command names, and setting headings **must not** contain
  the plugin name. Obsidian adds the plugin name automatically, so including
  it produces "Editorialist: Editorialist Begin" style duplication.
- Command names should be descriptive verbs, not placeholders like
  "Begin" or "Start". They appear in the command palette alongside hundreds
  of other commands.
- The README command list must match the commands actually registered by
  `registerCommands()`. Reviewers check this.

### 1.5 DOM and rendering

- No `innerHTML`, `outerHTML`, or `insertAdjacentHTML`. Use
  `createEl` / `createDiv` / `setText` instead.
- No `element.className =` — use `classList.add/remove/toggle`.
- No inline styles via `style="..."` or `element.style.foo = "..."`.
- `element.style.setProperty("--css-var", value)` is allowed **only** for
  CSS custom properties. Hardcoding pixel/color values is not.
- SVG elements must be created with `document.createElementNS(SVG_NS, ...)`.

### 1.6 Styling

- All colors come from Obsidian CSS variables (`--background-primary`,
  `--text-normal`, etc.). Hardcoded hex is banned, with one specific exception:
  **trademarked brand marks** (OpenAI / Anthropic / Gemini / Grok logos in
  `ContributorBrandMarks.ts`) may use their official brand colors. Any new
  exception must be documented at the top of the file with a brand/trademark
  justification.
- Prefer `color-mix(in srgb, var(--obsidian-var) x%, transparent)` for
  translucent surfaces so the result still tracks the theme.

### 1.7 Vault and filesystem access

- Prefer the Vault API (`app.vault.read`, `app.vault.modify`, `getAbstractFileByPath`, etc.).
- `app.vault.adapter` is allowed **only** when the target lives outside the
  Markdown-indexed vault — e.g. reading another plugin's `data.json` under
  `${vault.configDir}/plugins/...`. Document the reason with a one-line
  comment at the call site.
- Never hardcode absolute filesystem paths. Use `normalizePath` and vault
  APIs.

### 1.8 Network and telemetry

- No network requests without explicit user action.
- Use `requestUrl()` from `obsidian` for any HTTP call that might hit CORS.
- No analytics or telemetry, opt-in or otherwise, ship in this repo.

### 1.9 TypeScript hygiene

- No `any` / `as any` / `<any>` without a same-line `// SAFE:` comment
  explaining why.
- No `@ts-ignore`. `@ts-expect-error` is allowed **only** with a comment on
  the same line explaining what Obsidian API is missing.
- No `console.log` in `src/`. `console.error` / `console.warn` are allowed
  for genuine error paths.
- No `var`. Use `const` or `let`.

---

## 2. Release process

All of these rules are enforced by `scripts/obsidian-compliance.mjs`, which
runs as part of `npm run build`, `npm run check`, and `npm run release:check`.
If the compliance check fails, the build fails — fix the underlying issue
before retrying.

The release funnel:

```bash
# Sanity funnel — run as often as you like while developing.
npm run check              # typecheck + lint + css + qa-audit + compliance

# Full pre-release gate.
npm run release:check      # check + test + css-drift + build

# Bump version, sync manifest+versions+package.json, rebuild. Prints
# post-release manual steps (tag, push, GitHub Release, asset upload).
npm run release -- patch   # or: minor | major | x.y.z
```

`scripts/release.mjs` deliberately does **not** push commits, create tags, or
publish a GitHub Release. Those steps stay manual so we verify the artifacts
and release notes before anything becomes public.

### 2.1 GitHub Release requirements

The Obsidian community plugin updater fetches three files from the GitHub
Release matching the manifest version:

- `manifest.json`
- `main.js`
- `styles.css`

They must be attached as individual release assets — not zipped, not inside
a folder. The release tag must be the bare version string (e.g. `0.1.1`,
**not** `v0.1.1`).

### 2.2 First-time submission

For the initial community-plugin submission only, open a PR to
<https://github.com/obsidianmd/obsidian-releases> adding this plugin to
`community-plugins.json`. Subsequent releases only require a new GitHub
Release on this repo — the Obsidian updater picks them up automatically.
