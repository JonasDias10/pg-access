# Roadmap

```text
v0.1  DSL, AST, owner/authenticated/public/role, select/insert/update/delete, PostgreSQL compiler   (landed)
v0.2  and/or/not composition, better validation, CLI                                                 (landed)
v0.3  migrations, diff, check                                                                        (in progress)
v0.4  membership, tenant, RBAC
v0.5  Column Access Control
v0.6  PostgreSQL integration tests, testing package                                                  (landed)
v1.0  stable API, documentation, Supabase adapter
```

`and`/`or`/`not` composition and a from-scratch PostgreSQL integration test
suite landed in the first milestone already, folded in early because they
were needed to properly test `USING`/`WITH CHECK` and role derivation.

`@pg-access/cli` has landed, including a first, narrowly-scoped drift
detection story: `pg-access check` detects policies applied to the
database that are no longer in the config (or declared but not yet
applied), by name only, read-only; `pg-access generate --database-url`
closes the loop by including those drops in the next migration, still
nothing executed against the database directly by the CLI.

`@pg-access/testing`'s `asUser()`/`createSupabaseAuthStub()` have landed
too, packaging the role-switching/JWT-claims/rollback pattern the
project's own integration tests use into a reusable API for testing a
consumer's own schema.

Still ahead:

- Full `ALTER POLICY`-based diffing, instead of always drop+recreate.
- Membership/RBAC expressions.
- Column Access Control, intentionally not attempted yet. RLS filters
  rows, not columns. Solving per-column access correctly means real
  PostgreSQL mechanisms, such as column privileges, `GRANT`/`REVOKE`, and
  views (including `security_barrier` where needed), combined carefully
  with RLS, not a fake TypeScript-side filter that would only be cosmetic.
  That gets designed once the row-level compiler here has proven itself.
- ORM/query-builder adapters (Prisma, TypeORM, Drizzle, Kysely) that write
  `generateMigration()`'s output into each tool's own migration format.
  Currently at the research stage; see the open `integration`-labeled
  issues on GitHub.

## Contributing

This is an early-stage project. The one rule that matters most: **the DSL
never generates SQL directly**; new expressions add an AST node in
`@pg-access/core`, SQL generation for it lives entirely in
`@pg-access/postgres`'s compiler.

See
[CONTRIBUTING.md](https://github.com/JonasDias10/pg-access/blob/main/CONTRIBUTING.md)
for the full guide: setup, the testing requirements (including when a
change needs an integration test against real PostgreSQL, not just a
SQL-string assertion), code style, and the PR process.

Found a security issue rather than a regular bug? See
[SECURITY.md](https://github.com/JonasDias10/pg-access/blob/main/SECURITY.md)
instead of opening a public issue.
