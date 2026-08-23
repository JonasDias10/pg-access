# docs

The pg-access documentation site, built with [VitePress](https://vitepress.dev).

## Developing

```bash
pnpm build --filter=docs   # once, so reference/ exists and the Reference nav isn't broken
pnpm --filter docs dev
```

## Building

```bash
pnpm build --filter=docs
```

Use `pnpm build --filter=docs` (which runs through turbo), not
`pnpm --filter docs build` directly. `@pg-access/core`, `@pg-access/postgres`,
and `@pg-access/testing` are declared as `devDependencies` of this package
purely so turbo's `^build` graph builds them first; `typedoc`'s
`packages` entry-point strategy reads each one's compiled `.d.ts` via its
`package.json`, and silently produces an _empty_ reference (a warning, not
a failure) if they aren't built yet. Running through turbo builds them in
the right order automatically; a bare `pnpm --filter docs build` skips that
and only works by accident if they already happen to be built.

`reference/` is generated, not committed.

## Structure

```text
apps/docs/
├── index.md            Home page
├── guide/               Getting started, the DSL, architecture, security
├── cli/                 @pg-access/cli usage
├── testing/              @pg-access/testing usage
├── reference/            Generated API reference (gitignored)
└── .vitepress/config.ts  Site config, nav, sidebar
```

Code samples pull from real, tested source where possible (e.g.
`guide/getting-started.md` embeds `examples/basic/src/auth.ts` directly via
VitePress's file-inclusion syntax) rather than hand-written snippets that
can drift out of sync with the actual API.
