# Security

pg-access does not do authorization at runtime. It has no request
interceptor, no middleware, no in-process permission check. That's by
design, per this project's first principle: **PostgreSQL is the
authority.** What this library does is generate the
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` statements
that Postgres itself will enforce.

Consequences of that design worth being explicit about:

## A table with no row policies is left untouched, not locked down

Declaring `projects: {}` compiles to nothing; RLS is not force-enabled with
zero policies. Deliberately denying all access to a table still requires
writing at least one policy.

## Every identifier and literal is escaped

Never string-concatenated
([`packages/postgres/src/compiler/identifiers.ts`](https://github.com/JonasDias10/pg-access/blob/main/packages/postgres/src/compiler/identifiers.ts)),
and covered by dedicated escaping tests.

## `role("name")`'s SQL is a judgment call, documented as one

It reads the role from `auth.jwt() -> 'app_metadata' ->> 'role'`,
`app_metadata` specifically, because unlike `user_metadata` it can't be
edited by the user themselves. Applications that store roles differently
need a custom [`Dialect`](/guide/architecture#dialects), or should treat
this as a starting point to adapt, not a fixed contract, until this
becomes configurable.

## `not(...)` compiles to `IS NOT TRUE`

Not SQL's `NOT` operator. `NOT` follows three-valued logic (`NOT NULL` is
`NULL`, treated as "no match" in `USING`/`WITH CHECK`), so
`not(role("banned"))` under plain `NOT` would silently exclude every user
with no role claim at all, not just banned ones; `owner()` and `role()`
are both `NULL`, not `false`, when their underlying claim is absent.
`IS NOT TRUE` never itself returns `NULL`, so an undetermined
sub-expression is correctly treated as "not true" rather than as a match.

Found and fixed via the integration suite, not by inspection; see
[`packages/postgres/src/compiler/expressions.ts`](https://github.com/JonasDias10/pg-access/blob/main/packages/postgres/src/compiler/expressions.ts).

## Identifiers over 63 bytes are rejected at `defineAuth()` time

PostgreSQL silently truncates identifiers past `NAMEDATALEN` (63 usable
bytes, measured in UTF-8, not characters) instead of erroring, which could
make two differently-named columns collide unnoticed. Measured in bytes
because e.g. 32 `é` characters is 32 JS `.length` but 64 UTF-8 bytes,
already over the limit.

## Row policies assume the role already has table-level GRANTs

RLS and `GRANT` are separate layers; this compiler only emits the RLS
half; the coarse table-level `GRANT SELECT/INSERT/UPDATE/DELETE` is
assumed to exist already (true by default in a Supabase project, granted
schema-wide to `anon`/`authenticated`). Outside Supabase, a generated
migration alone gives you `permission denied for table`, not the RLS
filtering you'd expect, until you add that `GRANT` yourself.

## A custom Dialect is a first-class, tested path

See
[`custom-dialect.integration.test.ts`](https://github.com/JonasDias10/pg-access/blob/main/packages/postgres/test/integration/custom-dialect.integration.test.ts):
a dialect with no `auth` schema and no JWTs at all, reading the current
user from a plain session variable, compiled and run against a real server
through the exact same `compile()`. See [Architecture](/guide/architecture#dialects).

## RLS correctness has been verified against real PostgreSQL

Not just asserted as a SQL string, for every expression (`owner`,
`authenticated`, `publicAccess`, `role`, and their `and`/`or`/`not`
compositions) and across PostgreSQL 13 through 17 in CI. See the
integration test suite, which runs the compiled policies as a genuinely
non-superuser, non-owner Postgres role and checks actual row visibility
and write rejection. [`@pg-access/testing`](/testing/) packages that same
pattern for testing your own schema.
