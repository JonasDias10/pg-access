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

### Fixed

- `not(...)` now compiles to `IS NOT TRUE` instead of SQL's `NOT` operator: `NOT` follows three-valued logic, so `not(role("banned"))` was silently excluding every user with no role claim at all (not just banned ones), since an absent claim evaluates to `NULL`, not `false`. Found via the integration test suite.
