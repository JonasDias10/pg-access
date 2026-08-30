# @pg-access/core

Type-safe DSL and AST for declaring PostgreSQL authorization policies.
Framework-agnostic and side-effect-free: it produces a plain policy tree,
never SQL and never a database connection. `@pg-access/postgres` compiles
that tree into real Row-Level Security statements; `@pg-access/cli` wraps
both into a migration workflow.

## Usage

```ts
import { and, authenticated, defineAuth, owner, publicAccess, role } from "@pg-access/core";

export default defineAuth({
  projects: {
    rows: {
      select: owner("user_id"),
      insert: and(authenticated(), owner("user_id")),
      update: owner("user_id"),
      delete: owner("user_id"),
    },
  },
  posts: {
    rows: {
      select: publicAccess(),
      update: role("editor"),
    },
  },
});
```

`defineAuth(config)` validates the config and returns an `AuthNode`, the
AST every other package consumes. It throws on structural mistakes (an
unknown operation key, an empty table, a malformed expression) so a broken
config fails at load time rather than producing surprising SQL later.

## Expressions

Each operation (`select` / `insert` / `update` / `delete`) takes one
expression describing which rows the caller may act on:

- `owner(column)` - the row's `column` equals the caller's user id
  (`auth.uid()` in the default Postgres dialect).
- `authenticated()` - any signed-in caller.
- `publicAccess()` - everyone, signed in or not.
- `role(name)` - the caller's JWT carries `name` among its roles.
- `and(...)` / `or(...)` / `not(expr)` - compose the above. `not` compiles
  to `IS NOT TRUE`, so an absent claim is treated as "not allowed" rather
  than `NULL`.

Omitting an operation key leaves that operation with no pg-access policy
(Postgres then denies it once RLS is enabled, unless another policy grants
it).

## Also exported

`validate(config)` runs the same checks `defineAuth` does but returns a
`ValidationResult` instead of throwing. `OPERATIONS` / `isOperation` are
the operation-name constants and guard. The `*Node` types describe every
node the AST can contain, for tools that walk or transform it.

See the [pg-access docs](https://github.com/JonasDias10/pg-access) for the
end-to-end guide.
