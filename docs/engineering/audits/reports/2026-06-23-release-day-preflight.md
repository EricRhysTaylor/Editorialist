# Release-Day Preflight Audit — 2026-06-23

**Cadence:** Release-day / post-feature preflight  
**Audited by:** Codex  
**Branch / commit:** `master` @ `9c6dd67`  
**Release under review:** `1.0.8` draft  
**Verification status:** `pass` for release gate essentials; optional Obsidian typed lint wrapper inconclusive

---

## Cleanup Summary

Editorialist is release-ready from the standard gate perspective: `npm run typecheck`, `npm run check`, `npm test`, `npm run css-drift -- --maintenance`, and a side-effect-free production build all pass. The release-day audit found no product-code blocker, no doctrine violation, and no release-asset format issue.

The main release risk is not correctness but drift: the new author-query, Editorialisms, and release-note work continued the existing pattern of large `main.ts` / UI files. Keep the release moving, then use the next related feature pass for targeted extraction rather than pausing 1.0.8.

---

## Verification Evidence

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run check` | Pass: typecheck, lint, stylelint, CSS audit, QA audit, Obsidian compliance |
| `npm test` | Pass: 53 files, 644 tests |
| `npm run css-drift -- --maintenance` | Pass: clean, no warnings |
| `node esbuild.config.mjs production` | Pass: produced `main.js`, `manifest.json`, `styles.css` |
| Release assets present | `main.js` 430,796 bytes; `styles.css` 152,299 bytes; `manifest.json` 341 bytes |
| Optional `npm run check:ci` | Inconclusive: hung in `lint:obsidian` / typed ESLint config and was stopped |

---

## Risks / Issues Found

### RD-2026-06-23-#1 — Optional Obsidian typed lint wrapper hangs locally

- **Severity:** YELLOW
- **Confidence:** Medium
- **Risk:** The release gate itself is green, but `npm run check:ci` is not currently a dependable local preflight because it stalled inside `scripts/lint-obsidian-enforced.mjs`.
- **Evidence:** `package.json:26`, `scripts/lint-obsidian-enforced.mjs:27-44`, `eslint.obsidian.enforced.config.mjs:18-29`
- **Suggested next action:** After 1.0.8, add a timeout or split the typed Obsidian lint check into a CI-only diagnostic if local runtime continues to hang.

### RD-2026-06-23-#2 — Release tag is behind docs-only release-note commits

- **Severity:** GREEN
- **Confidence:** High
- **Risk:** Low. The `1.0.8` tag points at the version bump commit; later commits only polish draft notes and wiki images. The release workflow checks out the tag by default for assets, so product assets remain stable.
- **Evidence:** `.github/workflows/release-build.yml:25-29`, `.github/workflows/release-build.yml:37-42`, `git show --stat 1.0.8..HEAD`
- **Suggested next action:** Do nothing for 1.0.8. Keep using the GitHub release body for notes polish.

---

## Product Doctrine Check

- Author control: OK — new user-facing flows are opt-in.
- Local-first: OK — no hidden network or telemetry surfaced; release-note image URLs are documentation-only.
- Manuscript safety: OK — cut backup remains preservation-only and does not mutate suggestion status.
- Conservative suggestion matching: OK — gate and tests pass; no new loose matching was added during release-note polish.
- Bulk action safety: OK — no new bulk destructive action was introduced.
- Contributor transparency: OK — no contributor metadata regression surfaced.
- Obsidian-native behavior: OK — standard compliance gate passes; no command-name/plugin-name duplication found.
- Submission compliance: OK — `npm run check` and `scripts/obsidian-compliance.mjs` pass.

---

## Deferred Concerns

- Keep `src/main.ts`, `src/ui/ReviewPanel.ts`, and `src/ui/EditorialistSettingTab.ts` on the next cleanup list; do not block 1.0.8 on a broad extraction.
- Investigate why the typed Obsidian lint invocation hangs locally before relying on `npm run check:ci` as a release-day gate.

---

## Release Recommendation

Proceed with the draft release finish step after human review of the notes. No code changes are required before publishing 1.0.8.
