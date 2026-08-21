# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased], v0.1

### Added

- Monorepo scaffolding (pnpm workspaces + Turborepo).
- `@pg-access/core`: `defineAuth`, `owner`, `authenticated`, `publicAccess`, `role` expressions, row policy AST for `select` / `insert` / `update` / `delete`.
- `@pg-access/postgres`: PostgreSQL compiler that turns the AST into `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` statements, with a Supabase-flavored default dialect (`auth.uid()`, `authenticated` role).
- Deterministic policy naming (`<table>_<operation>`).
- Correct `USING` / `WITH CHECK` clause placement per operation.
- Identifier and literal escaping for safe SQL generation.
- Unit tests for AST, expressions, and the compiler, including a custom `Dialect` proving the Supabase dialect isn't hardcoded into `compile()`.
- Integration tests running generated SQL against real PostgreSQL 13 through 17 (Docker locally, matrix in CI): every expression and composition, a reserved-keyword table name, and a custom non-Supabase `Dialect`.
- Identifier-length validation (rejects identifiers over PostgreSQL's 63-byte `NAMEDATALEN` limit instead of letting them silently truncate).
- `examples/basic`: end-to-end example producing a runnable migration file.
- `SECURITY.md` and Changesets scaffolding for future releases.
- `@pg-access/cli`: `pg-access init` scaffolds a starter `pgaccess.config.ts`; `pg-access generate` locates and loads that config and writes a timestamped migration via `@pg-access/postgres`'s `generateMigration()`, replacing the hand-written script `examples/basic/src/generate.ts` used before; `pg-access check` connects to a live database and reports policies the config declares that aren't applied yet ("missing") or pg-access-managed policies that are applied but no longer declared ("orphaned"), read-only and exits non-zero on drift so it's usable as a CI gate.
- `@pg-access/postgres`: `listManagedPolicies()` reads `pg_policies` for pg-access-named (`<table>_<operation>`) policies on a set of tables; `diffPolicies()` compares that against an `AuthNode` to compute the same missing/orphaned sets `check` reports.
- `compile()` (and `generateMigration()`/`pg-access generate`) accept `existingPolicies`: when given, they also emit `drop policy if exists` for any managed policy no longer declared in the config, closing the gap where a row policy removed from the config entirely used to stay orphaned forever. `pg-access generate --database-url <url>` (or `DATABASE_URL`) fetches that list and includes the drops in the migration file; nothing is ever executed against the database directly.
- `@pg-access/testing`: `asUser()` runs a query as a simulated end user (JWT claims + PostgreSQL role) inside a transaction that's always rolled back afterward, and `createSupabaseAuthStub()` installs minimal `auth.uid()`/`auth.jwt()` functions for testing against a plain, non-Supabase PostgreSQL database. Extracted from the pattern `@pg-access/postgres`'s own integration test suite already used, so a project consuming `@pg-access/core`/`@pg-access/postgres` can test its own schema the same way without the hand-rolled boilerplate.
- `apps/docs`: a VitePress documentation site (guide, CLI/testing reference, and an API reference generated from `@pg-access/core`/`@pg-access/postgres`/`@pg-access/testing`'s `.d.ts` output via typedoc). Code samples embed real files from `examples/basic` directly rather than hand-written snippets that can drift out of sync with the actual API.

### Fixed

- `not(...)` now compiles to `IS NOT TRUE` instead of SQL's `NOT` operator: `NOT` follows three-valued logic, so `not(role("banned"))` was silently excluding every user with no role claim at all (not just banned ones), since an absent claim evaluates to `NULL`, not `false`. Found via the integration test suite.
