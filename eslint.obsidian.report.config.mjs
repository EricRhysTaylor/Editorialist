// Official Obsidian guideline lint — report-only.
//
// This intentionally lives outside eslint.config.mjs so Editorialist's existing
// blocking `npm run lint` remains stable. Use `npm run lint:obsidian:report`
// to inspect the full eslint-plugin-obsidianmd recommended preset.
import tsparser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

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
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
