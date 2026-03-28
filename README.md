# Editorialist

A local-first editorial review system for structured manuscript revisions in Obsidian.

## What it is

Editorialist helps authors review structured revision proposals inside the manuscript they are already editing. It parses review blocks, matches them conservatively against note content, and keeps all manuscript changes explicit and local.

## Why it exists

Editorialist is a review layer, not an AI rewriting system. It is built to preserve author control, surface editorial intent clearly, and avoid hidden manuscript mutation.

## Current status

Editorialist is in early development. The current focus is a safe review workflow for parsing, matching, navigation, highlighting, and explicit accept or reject actions.

## Development setup

```bash
npm install
npm run build:dev
```

Then open Obsidian, enable the Editorialist plugin in the dev vault, and iterate.

## Development commands

- `npm run build` - build the plugin bundle
- `npm run build:dev` - build and copy into the local Obsidian dev vault
- `npm run check` - run TypeScript, ESLint, Stylelint, and CSS audit checks
- `npm run backup` - run checks, commit, and push changes
