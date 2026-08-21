# Contributing to pg-access

Thanks for taking the time to contribute. This is an early-stage project
(v0.1), so expect the API and internals to keep moving; check the
[roadmap in the README](README.md#roadmap) before starting anything large,
so we don't duplicate effort.

Found a security issue instead of a regular bug? See
[SECURITY.md](SECURITY.md); please don't open a public issue for those.

Everyone participating is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## The one rule that matters most

**The DSL never generates SQL directly.** Every change has to respect the
pipeline:

```text
TypeScript DSL  →  AST  →  PostgreSQL compiler  →  SQL
```

A new expression (like `owner()` or `role()`) adds an AST node in
`@pg-access/core`; it returns a plain object, never a string of SQL. The
SQL for that node is a separate concern that lives entirely in
`@pg-access/postgres`'s compiler. If a PR makes `@pg-access/core` import
anything from `@pg-access/postgres`, or makes it produce SQL strings, that's
a sign the change needs to be restructured, not just reviewed harder.

## Project map

```text
packages/
├── core/       DSL + AST. No SQL, no PostgreSQL, no Supabase.
├── postgres/   Compiles the AST into PostgreSQL DDL + migrations.
├── cli/        `pg-access init` / `generate` / `check` (read-only drift detection).
└── testing/    (planned) not implemented yet
```

See the README's [Architecture](README.md#architecture) section for why
it's split this way, and [Security](README.md#security) for the
non-obvious decisions already made (NULL-handling in `not()`, the
`TO <role>` clause being an optimization and not the security boundary,
etc.); worth reading before touching the compiler, so you don't
re-introduce something already fixed for a reason.

## Setting up

```bash
pnpm install
pnpm build
```

## Making a change

1. **Unit tests are required for every change.** Add or extend tests under
   the relevant package's `test/` directory.
2. **Changes to `USING`/`WITH CHECK` placement, identifier/literal
   escaping, or anything touching row/column visibility need an
   integration test against real PostgreSQL, not just a SQL-string
   assertion.** This project has already found and fixed a real bug this
   way (`not()`'s NULL-handling) that every unit test had missed. Start
   the database with:

   ```bash
   docker compose -f docker-compose.test.yml up -d
   pnpm --filter @pg-access/postgres test:integration
   ```

   `pnpm test:integration` at the repo root runs every package's
   integration suite against that same database, one package at a time
   (`turbo run test:integration --concurrency=1`). This is required, not
   just slower-but-safe: several suites create the real, global `auth`
   schema and `authenticated` role Supabase itself uses (not a
   per-test-scoped name), so two packages' suites touching them at the
   same time race on `CREATE SCHEMA`/`CREATE ROLE`/`DROP ROLE` and fail
   with spurious errors that have nothing to do with the code under test.

3. **Run the full check suite before opening a PR:**

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm format:check   # or `pnpm format` to auto-fix
   pnpm build
   pnpm test
   pnpm test:integration
   ```

4. **Add a changeset** if your change touches `@pg-access/core`,
   `@pg-access/postgres`, or `@pg-access/cli` and should land in a future
   release:

   ```bash
   pnpm changeset
   ```

   Not needed for docs-only changes, CI/config changes, or changes scoped
   to `examples/`.

## Code style

- TypeScript strict mode, no `any` without a strong justification, no
  casts to silence errors.
- Default to no comments. Only add one when the _why_ isn't obvious from
  the code itself (a PostgreSQL quirk, a non-obvious trade-off); not to
  restate what a well-named function already says.
- No abstractions beyond what the change actually needs. Three similar
  lines beat a premature helper.
- Prettier formats everything (`pnpm format`); don't hand-format around it.

## Opening a pull request

The PR template will walk you through the checklist above. Keep PRs
focused; a new expression, a compiler fix, a doc improvement are each
their own PR rather than bundled together, so they're easy to review and
easy to revert independently if something's wrong.

## Questions

Open an issue with the "question" label if something in this guide, the
README, or the code is unclear. Confusing docs are worth fixing.
