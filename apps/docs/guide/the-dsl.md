# The DSL

Four expressions ship in this first milestone, all composable with `and()`,
`or()`, and `not()`.

| Expression        | Grants access to...                          |
| ----------------- | -------------------------------------------- |
| `owner("column")` | rows where `column` matches the current user |
| `authenticated()` | any signed-in user                           |
| `publicAccess()`  | everyone, including anonymous requests       |
| `role("admin")`   | users carrying a given application role      |

## Composition

```ts
import { and, authenticated, not, or, owner, role } from "@pg-access/core";

and(authenticated(), owner("user_id"));

or(role("admin"), owner("user_id"));

and(owner("user_id"), not(role("banned")));
```

`not(...)` compiles to `IS NOT TRUE`, not SQL's `NOT` operator; see
[Security](/guide/security#not-compiles-to-is-not-true) for why that matters.

## Row policies

Each table accepts one expression per row operation: `select`, `insert`,
`update`, `delete`.

```ts
import { defineAuth, owner } from "@pg-access/core";

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

A table with no row policies compiles to nothing; RLS is left untouched,
not force-enabled with zero policies (which would silently deny all
access). Deliberately locking a table down still requires writing at least
one policy.

## Validation

`defineAuth` validates the AST immediately; malformed compositions and
identifiers over PostgreSQL's 63-byte `NAMEDATALEN` limit throw a readable,
path-annotated error instead of silently producing broken or truncated SQL:

```ts
defineAuth({
  "": { rows: { select: owner("user_id") } },
});
// throws: Invalid pg-access configuration:
//   - [table] Table name must not be empty.
```

The expression builders themselves (`owner()`, `role()`, ...) also guard
against obviously-invalid input as soon as you call them, before a
malformed AST node can even be constructed:

```ts
owner("");
// throws: owner(column) requires a non-empty column name.
```

See the [API reference](/reference/) for every expression's exact type
signature.
