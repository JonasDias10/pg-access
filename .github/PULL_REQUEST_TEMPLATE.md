## What does this change do, and why?

<!-- One or two sentences. Link an issue if there is one. -->

## Checklist

- [ ] The DSL still never generates SQL directly (new expressions are AST
      nodes in `@pg-access/core`; SQL generation lives in
      `@pg-access/postgres`'s compiler)
- [ ] Unit tests added/updated
- [ ] If this touches `USING`/`WITH CHECK` placement, identifier/literal
      escaping, or row/column visibility: an integration test against real
      PostgreSQL was added/updated (`pnpm test:integration`), not just a
      SQL-string assertion
- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm test`
      all pass locally
- [ ] A changeset was added (`pnpm changeset`) if this touches
      `@pg-access/core` or `@pg-access/postgres` and should land in a
      future release; not needed for docs/CI-only changes

## Anything reviewers should know?

<!-- Trade-offs made, things intentionally left out, open questions. -->
