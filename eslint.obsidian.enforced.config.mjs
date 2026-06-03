// Enforced official Obsidian lint subset.
//
// The full eslint-plugin-obsidianmd recommended preset is report-only in
// eslint.obsidian.report.config.mjs. This config promotes only confirmed,
// high-signal overlap with Editorialist's existing audits.
import tsparser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export const ENFORCED_OBSIDIAN_RULES = [
  'obsidianmd/no-static-styles-assignment',
  'obsidianmd/prefer-window-timers',
];

export default defineConfig([
  {
    ignores: [
      'release/**',
      'dist/**',
      'main.js',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'scripts/**',
      'tests/**',
      'src/**/*.test.ts',
    ],
  },
  {
    files: ['src/**/*.ts'],
    plugins: {
      obsidianmd,
    },
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: Object.fromEntries(ENFORCED_OBSIDIAN_RULES.map(rule => [rule, 'error'])),
  },
]);
