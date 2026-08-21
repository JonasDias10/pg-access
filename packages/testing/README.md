# @pg-access/testing

Helpers for testing PostgreSQL Row-Level Security policies against a real
database, extracted from the pattern `@pg-access/postgres`'s own
integration test suite uses (`packages/postgres/test/integration`): switch
to a role, simulate a JWT's claims, run a query, roll everything back.

## `asUser`

```ts
import { Pool } from "pg";
import { asUser } from "@pg-access/testing";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const rows = await asUser(pool, { claims: { sub: userId } }, async (client) => {
  const result = await client.query('select * from "projects";');
  return result.rows;
});
```

`asUser(pool, options, run)`:

- Opens a connection, begins a transaction, `set local role`s to
  `options.role` (default `"authenticated"`, matching
  `@pg-access/postgres`'s default dialect), and - if `options.claims` is
  given - sets `request.jwt.claims` to it, the session setting
  `auth.uid()`/`auth.jwt()` read from.
- Runs `run(client)` and returns its result.
- Always rolls back afterward, whether `run` succeeds or throws, and
  releases the client. A test using `asUser` never needs its own cleanup
  for whatever `run` wrote.
- Omit `claims` (or pass `null`) to simulate an unauthenticated request -
  no claims are set at all.
- Works against any `pg.Pool`, not tied to a specific test runner.

## `createSupabaseAuthStub`

```ts
import { createSupabaseAuthStub } from "@pg-access/testing";

await createSupabaseAuthStub(pool); // once, before your tests run
```

Installs minimal `auth.uid()`/`auth.jwt()` functions that read
`request.jwt.claims` the same way Supabase's real ones do. Only needed
against a plain, non-Supabase PostgreSQL database (a real Supabase project
already has the real functions) - without it, policies compiled by
`@pg-access/postgres`'s default dialect have nothing to call.

## End-to-end example

```ts
import { randomUUID } from "node:crypto";
import { defineAuth, owner } from "@pg-access/core";
import { compile } from "@pg-access/postgres";
import { asUser, createSupabaseAuthStub } from "@pg-access/testing";
import { Pool } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

describe("projects RLS", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const userId = randomUUID();

  beforeAll(async () => {
    await createSupabaseAuthStub(pool);

    await pool.query(`
      create table if not exists "projects" (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        name text not null
      );
    `);

    const auth = defineAuth({
      projects: { rows: { select: owner("user_id") } },
    });
    await pool.query(compile(auth).sql);

    await pool.query('insert into "projects" (user_id, name) values ($1, $2);', [
      userId,
      "my project",
    ]);
  });

  it("only returns the caller's own projects", async () => {
    const rows = await asUser(pool, { claims: { sub: userId } }, async (client) => {
      const result = await client.query('select name from "projects";');
      return result.rows;
    });

    expect(rows).toEqual([{ name: "my project" }]);
  });

  it("returns nothing for an unauthenticated request", async () => {
    const rows = await asUser(pool, {}, async (client) => {
      const result = await client.query('select name from "projects";');
      return result.rows;
    });

    expect(rows).toEqual([]);
  });
});
```

See `test/integration/as-user.integration.test.ts` in this package for the
same example actually run against a real PostgreSQL server (also granting
the roles/privileges Postgres itself requires, left out above for brevity).
