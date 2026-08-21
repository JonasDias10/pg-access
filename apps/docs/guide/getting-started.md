# Getting started

## Install

```bash
pnpm add @pg-access/core @pg-access/postgres
```

`@pg-access/core` is the DSL: it builds a plain AST, no SQL, no PostgreSQL,
no Supabase. `@pg-access/postgres` compiles that AST into real PostgreSQL
DDL. Keeping them separate is deliberate; see [Architecture](/guide/architecture).

## Define your table's access rules

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

`defineAuth` validates the config immediately (empty column/role names,
malformed compositions) and throws a readable error rather than silently
producing broken SQL.

## Generate a migration with the CLI

Writing the compiled SQL to a timestamped migration file by hand is what
[`@pg-access/cli`](/cli/) is for:

```bash
pnpm add -D @pg-access/cli
npx pg-access init      # scaffolds pgaccess.config.ts
npx pg-access generate  # writes supabase/migrations/<timestamp>_pg_access.sql
```

## A complete, runnable example

The DSL above is the real content of
[`examples/basic/src/auth.ts`](https://github.com/JonasDias10/pg-access/blob/main/examples/basic/src/auth.ts)
in this repository:

<<< @/../../examples/basic/src/auth.ts

Run it (writes a real migration file and prints the SQL) from the repo root:

```bash
pnpm install
pnpm --filter @pg-access/example-basic generate
```

## Next steps

- [The DSL](/guide/the-dsl) covers every expression, and how composition works.
- [USING vs WITH CHECK](/guide/using-vs-with-check) covers the Postgres rules the compiler encodes.
- [Security](/guide/security) covers the non-obvious decisions already made for you.
- [Testing](/testing/) covers testing your own RLS policies against a real database.
