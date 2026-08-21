// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // packages/cli/bin/pg-access.js is a deliberately plain, untyped
    // Node entry shim (it just re-exports into the compiled build/ output),
    // not part of the package's TypeScript project. apps/docs/.vitepress/
    // dist+cache and apps/docs/reference are generated (VitePress's build
    // output and typedoc's markdown output), not source.
    ignores: [
      "**/build/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "packages/cli/bin/**",
      "apps/docs/.vitepress/dist/**",
      "apps/docs/.vitepress/cache/**",
      "apps/docs/reference/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        // Type-aware linting (needed for no-floating-promises below):
        // auto-discovers each linted file's nearest tsconfig.json instead
        // of requiring one hand-maintained `project` array for the whole
        // monorepo.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      // Async test/setup code (this repo is full of it, especially the
      // integration tests) silently drops errors if a promise is never
      // awaited or returned - this catches that at lint time instead of as
      // a flaky, hard-to-explain test failure.
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
);
