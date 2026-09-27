# Architecture

```text
packages/
├── core/       DSL + AST. No SQL, no PostgreSQL, no Supabase.
├── postgres/   Compiles the AST into PostgreSQL DDL + migrations.
├── cli/        pg-access init / generate / check (read-only drift detection).
├── typeorm/    Writes migrations as TypeORM classes, with a down() that restores the previous policies.
└── testing/    asUser() + createSupabaseAuthStub() for testing RLS against a real database
```

```text
TypeScript DSL  →  AST  →  PostgreSQL compiler  →  SQL  →  Migration  →  PostgreSQL
```

## The DSL never generates SQL directly

Every expression (`owner(...)`, `authenticated()`, and so on) builds a
plain AST node; `owner("user_id")` returns `{ type: "owner", column:
"user_id" }`, not a SQL string. A separate compiler package turns that AST
into SQL. That separation is what lets:

- `@pg-access/postgres` decide _how_ `owner()` becomes SQL. Today that's
  Supabase's `auth.uid()`; a non-Supabase dialect could resolve the current
  user differently without touching the DSL or your table definitions.
- the AST be statically validated before any SQL exists.
- future compilers, diffing, or documentation generation build on the same
  AST without re-parsing SQL.

`@pg-access/core` never imports SQL or Supabase concepts, full stop. If a
change makes `@pg-access/core` import anything from `@pg-access/postgres`,
or produce a SQL string itself, that's a sign the change needs to be
restructured, not just reviewed harder.

## Dialects

`@pg-access/postgres` ships one default dialect
(`packages/postgres/src/dialect/postgres.ts`) that targets vanilla
PostgreSQL together with Supabase's `auth` schema helpers. Supabase is this
project's first integration target, and those helpers are themselves plain
SQL functions, not a runtime dependency, so shipping this as the default
doesn't violate "core stays Supabase-agnostic": it lives in the compiler
package, is swappable, and `@pg-access/core` still has no idea it exists.

```ts
export interface Dialect {
  readonly currentUserIdExpression: string;
  readonly authenticatedRole: string;
  readonly publicRole: string;
  roleExpression(roleLiteral: string): string;
}
```

A custom `Dialect` is a first-class, tested path, not just a hypothetical -
see
[`custom-dialect.integration.test.ts`](https://github.com/JonasDias10/pg-access/blob/main/packages/postgres/test/integration/custom-dialect.integration.test.ts):
a dialect with no `auth` schema and no JWTs at all, reading the current
user from a plain session variable, compiled and run against a real server
through the exact same `compile()`.

## `TO <role>` is an optimization, not the security boundary

Every compiled policy's `USING`/`WITH CHECK` boolean expression is
self-contained and correct on its own. The `TO authenticated` / `TO
public` role clause only lets Postgres skip evaluating that expression for
requests outside the role, so getting the role derivation conservative
(defaulting to `authenticated`) can only under-optimize, never over-grant.
See the comment in `packages/postgres/src/compiler/policies.ts` for the
exact rule and its current known limitation with
`or(publicAccess(), ...)` compositions.

## Where each package fits

- **`@pg-access/core`** is the DSL and AST; it's what you write in your config file.
- **`@pg-access/postgres`** provides `compile()`, `generateMigration()`, and
  the introspection/diffing (`listManagedPolicies()`, `diffPolicies()`,
  `planPolicyChanges()`) that `check` and `generate --database-url` are
  built on. `compile()` alone, with no database, drop-and-recreates every
  policy; `planPolicyChanges()` diffs against a live database and emits
  `ALTER POLICY` for what drifted, `CREATE` for what's missing, and nothing
  for policies that already match.
- **[`@pg-access/cli`](/cli/)** is the `pg-access` command: `init`,
  `generate`, `check`. A thin wrapper; no compiler or diffing logic lives
  here.
- **[`@pg-access/testing`](/testing/)** provides `asUser()` and
  `createSupabaseAuthStub()`, for testing your own schema's RLS against a
  real database.
