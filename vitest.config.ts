import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
		environment: "node",
		globals: true,
		alias: {
			obsidian: path.resolve(here, "tests/mocks/obsidian.ts"),
		},
	},
});
