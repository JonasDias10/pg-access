// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/build/**", "**/node_modules/**", "**/.turbo/**", "**/coverage/**"],
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
