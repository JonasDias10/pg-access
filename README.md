<picture>
  <source media="(prefers-color-scheme: dark)" srcset="pg-access-dark.png">
  <img src="pg-access.png" alt="pg-access">
</picture>

**A type-safe, declarative way to define PostgreSQL Row-Level Security. It compiles down to real SQL, not a runtime layer.**

A fuller guide, CLI/testing reference, and generated API docs live in
[`apps/docs`](apps/docs) (run `pnpm --filter docs dev` to browse them
locally); this README stays the quick tour.

```ts
import { defineAuth, owner } from "@pg-access/core";

export default defineAuth({
  projects: {
    rows: {
      select: owner("user_id"),
      update: owner("user_id"),
    },
  },
});
```

compiles to:

```sql
alter table "projects" enable row level security;

create policy "projects_select"
on "projects"
for select
to "authenticated"
using (
  "user_id" = (select auth.uid())
);

create policy "projects_update"
on "projects"
for update
to "authenticated"
using (
  "user_id" = (select auth.uid())
)
with check (
  "user_id" = (select auth.uid())
);
```

That SQL is the whole point. pg-access does not intercept your queries or check
permissions in your application process. It generates real `CREATE POLICY`
statements that PostgreSQL itself enforces, for every client, every query,
forever. Think of it as a migration tool, but for authorization instead of schema.

## The problem

Row-Level Security is the right place to put authorization in a Postgres/
Supabase app: it's enforced by the database, not bypassable from a leaked
API key, and applies uniformly to every access path (REST, GraphQL, a
direct `psql` session, a background job). But hand-written RLS has sharp
edges that don't show up until production:

- **`USING` vs `WITH CHECK` are easy to confuse.** An `INSERT` policy that
  defines `USING` instead of `WITH CHECK` is simply rejected by Postgres;
  an `UPDATE` policy that only defines `USING` lets a user retarget a row
  they own to values they shouldn't be able to write.
- **Performance footguns are invisible in a code review.** Calling
  `auth.uid()` directly in a policy re-evaluates it per row; wrapping it as
  `(select auth.uid())` lets Postgres cache it once per statement. Nothing
  about the syntax warns you either way.
- **Policies drift from the code that assumes them.** "Users can only see
  their own rows" is a fact your application logic depends on, but it lives
  in a migration file, disconnected from type checking, and easy to forget
  to update when a table's ownership model changes.
- **There's no single place to read what a table's access rules are.**
  They accumulate across migrations as `CREATE POLICY`, `ALTER POLICY`, and
  `DROP POLICY` statements over time.

## How pg-access helps

pg-access gives you a small TypeScript DSL for the _intent_, such as "select
is owner-scoped by `user_id`", and a compiler that always produces
Postgres-correct SQL for that intent: the right clause (`USING`, `WITH CHECK`,
or both) for the operation, the performance-correct `(select auth.uid())`
form, deterministic policy names, and properly escaped identifiers. The DSL
is the one place your table's authorization rules live, and it's ordinary,
type-checked, refactorable TypeScript.

```text
TypeScript DSL  →  AST  →  PostgreSQL compiler  →  SQL  →  Migration  →  PostgreSQL
```

The DSL never generates SQL directly. Every expression (`owner(...)`,
`authenticated()`, and so on) builds a plain AST node, and a separate
compiler package turns that AST into SQL. That's what makes the AST
inspectable, testable, and, eventually, compilable to more than one output.

## Minimal example

```ts
import { and, authenticated, defineAuth, owner } from "@pg-access/core";
import { compile } from "@pg-access/postgres";

const auth = defineAuth({
  projects: {
    rows: {
      select: owner("user_id"),
      insert: and(authenticated(), owner("user_id")),
      update: owner("user_id"),
      delete: owner("user_id"),
    },
  },
});

const { sql } = compile(auth);
console.log(sql);
```

Run the fuller version of this (including writing a timestamped migration
file) with:

```bash
pnpm install
pnpm --filter @pg-access/example-basic generate
```

See [examples/basic](examples/basic), or [examples/supabase](examples/supabase)
for the same pipeline against a real local Supabase project, with a small
Fastify API and integration tests proving the generated policies hold up
against real signed-in users.

## The DSL

Four expressions ship in this first milestone, all composable with `and()`,
`or()`, and `not()`:

| Expression        | Grants access to...                          |
| ----------------- | -------------------------------------------- |
| `owner("column")` | rows where `column` matches the current user |
| `authenticated()` | any signed-in user                           |
| `publicAccess()`  | everyone, including anonymous requests       |
| `role("admin")`   | users carrying a given application role      |

```ts
and(authenticated(), owner("user_id"));
```

Each table accepts one expression per row operation: `select`, `insert`,
`update`, `delete`.

```ts
defineAuth({
  projects: {
    rows: {
      select: owner("user_id"),
      update: owner("user_id"),
      delete: owner("user_id"),
    },
  },
});
```

`defineAuth` validates the config immediately (empty column/role names,
malformed compositions) and throws a readable error rather than silently
producing broken SQL.

## Architecture

```text
packages/
├── core/       DSL + AST. No SQL, no PostgreSQL, no Supabase.
├── postgres/   Compiles the AST into PostgreSQL DDL + migrations.
├── cli/        pg-access init / generate / check (read-only drift detection).
└── testing/    asUser() + createSupabaseAuthStub() for testing RLS against a real database
```

**`@pg-access/core` never imports SQL or Supabase concepts.** `owner()`
returns `{ type: "owner", column: "user_id" }`, an AST node, not a SQL
string. That separation is what lets:

- `@pg-access/postgres` decide _how_ `owner()` becomes SQL. Today that's
  Supabase's `auth.uid()`; a non-Supabase dialect could resolve the current
  user differently without touching the DSL or your table definitions.
- the AST be statically validated before any SQL exists.
- future compilers, diffing, or documentation generation build on the same
  AST without re-parsing SQL.

**Dialects.** `@pg-access/postgres` ships one default dialect
(`packages/postgres/src/dialect/postgres.ts`) that targets vanilla
PostgreSQL together with Supabase's `auth` schema helpers. Supabase is this
project's first integration target, and those helpers are themselves plain
SQL functions, not a runtime dependency, so shipping this as the default
doesn't violate "core stays Supabase-agnostic": it lives in the compiler
package, is swappable, and `@pg-access/core` still has no idea it exists.

**`TO <role>` is an optimization, not the security boundary.** Every
compiled policy's `USING`/`WITH CHECK` boolean expression is self-contained
and correct on its own. The `TO authenticated` / `TO public` role clause
only lets Postgres skip evaluating that expression for requests outside the
role, so getting the role derivation conservative (defaulting to
`authenticated`) can only under-optimize, never over-grant. See the comment
in `packages/postgres/src/compiler/policies.ts` for the exact rule and its
current known limitation with `or(publicAccess(), ...)` compositions.

## `USING` vs `WITH CHECK`

The compiler places the compiled condition according to Postgres's actual
rules per operation. This is not a detail you can get right by treating
every policy the same:

| Operation | Clause(s)                    | Why                                                                                                  |
| --------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `select`  | `USING`                      | filters existing rows; there's no new row to check.                                                  |
| `insert`  | `WITH CHECK`                 | there's no existing row to filter with; Postgres rejects a `USING` clause on an INSERT policy.       |
| `update`  | `USING` **and** `WITH CHECK` | `USING` picks which existing rows may be targeted, `WITH CHECK` validates the row _after_ the write. |
| `delete`  | `USING`                      | filters which existing rows may be deleted.                                                          |

This is covered by dedicated tests in
`packages/postgres/test/unit/policies.test.ts`, and exercised end-to-end
(including the actual Postgres rejection error) in
`packages/postgres/test/integration/rls.integration.test.ts`.

## Security

pg-access does not do authorization at runtime. It has no request
interceptor, no middleware, no in-process permission check. That's by
design, per this project's first principle: **PostgreSQL is the authority.**
What this library does is generate the `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
and `CREATE POLICY` statements that Postgres itself will enforce.

Consequences of that design worth being explicit about:

- **A table with no row policies is left untouched, not locked down.**
  Declaring `projects: {}` compiles to nothing; RLS is not force-enabled
  with zero policies. Deliberately denying all access to a table still
  requires writing at least one policy.
- **Every identifier and literal is escaped**, never string-concatenated
  (`packages/postgres/src/compiler/identifiers.ts`), and covered by
  dedicated escaping tests.
- **`role("name")`'s SQL is a judgment call, documented as one.** It reads
  the role from `auth.jwt() -> 'app_metadata' ->> 'role'`, `app_metadata`
  specifically, because unlike `user_metadata` it can't be edited by the
  user themselves. Applications that store roles differently need a custom
  dialect, or should treat this as a starting point to adapt, not a fixed
  contract, until this becomes configurable.
- **`not(...)` compiles to `IS NOT TRUE`, not SQL's `NOT` operator.** `NOT`
  follows three-valued logic (`NOT NULL` is `NULL`, treated as "no match"
  in `USING`/`WITH CHECK`), so `not(role("banned"))` under plain `NOT`
  would silently exclude every user with no role claim at all, not just
  banned ones; `owner()` and `role()` are both `NULL`, not `false`, when
  their underlying claim is absent. `IS NOT TRUE` never itself returns
  `NULL`, so an undetermined sub-expression is correctly treated as "not
  true" rather than as a match. Found and fixed via the integration suite,
  not by inspection; see `packages/postgres/src/compiler/expressions.ts`.
- **Identifiers over 63 bytes are rejected at `defineAuth()` time.**
  PostgreSQL silently truncates identifiers past `NAMEDATALEN` (63 usable
  bytes, measured in UTF-8, not characters) instead of erroring, which
  could make two differently-named columns collide unnoticed. Measured in
  bytes because e.g. 32 `é` characters is 32 JS `.length` but 64 UTF-8
  bytes, already over the limit.
- **Row policies assume the role already has table-level `GRANT`s.**
  RLS and `GRANT` are separate layers; this compiler only emits the RLS
  half; the coarse table-level `GRANT SELECT/INSERT/UPDATE/DELETE` is
  assumed to exist already (true by default in a Supabase project, granted
  schema-wide to `anon`/`authenticated`). Outside Supabase, a generated
  migration alone gives you `permission denied for table`, not the RLS
  filtering you'd expect, until you add that `GRANT` yourself.
- **A custom `Dialect` is a first-class, tested path, not just a
  hypothetical.** See `packages/postgres/test/integration/custom-dialect.integration.test.ts`:
  a dialect with no `auth` schema and no JWTs at all, reading the current
  user from a plain session variable, compiled and run against a real
  server through the exact same `compile()`.
- **RLS correctness has been verified against real PostgreSQL**, not just
  asserted as a SQL string, for every expression (`owner`, `authenticated`,
  `publicAccess`, `role`, and their `and`/`or`/`not` compositions) and
  across PostgreSQL 13 through 17 in CI. See the integration test suite,
  which runs the compiled policies as a genuinely non-superuser, non-owner
  Postgres role and checks actual row visibility and write rejection.

## Contributing

This is an early-stage project. The one rule that matters most: **the DSL
never generates SQL directly**; new expressions add an AST node in
`@pg-access/core`, SQL generation for it lives entirely in
`@pg-access/postgres`'s compiler.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide: setup, the
testing requirements (including when a change needs an integration test
against real PostgreSQL, not just a SQL-string assertion), code style, and
the PR process.

Found a security issue rather than a regular bug? See
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

MIT
