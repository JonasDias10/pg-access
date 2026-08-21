import { randomUUID } from "node:crypto";
import { defineAuth, owner } from "@pg-access/core";
import { compile } from "@pg-access/postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser } from "../../src/as-user.js";
import { createSupabaseAuthStub } from "../../src/create-supabase-auth-stub.js";

/**
 * The "documented example testing a defineAuth() config end-to-end" the
 * package exists for: define a real policy, compile and apply it, then use
 * asUser() to prove row visibility against a real PostgreSQL server -
 * without hand-rolling the JWT-claims/role-switching/transaction-rollback
 * boilerplate this package packages up.
 *
 * Requires a database reachable at PG_ACCESS_TEST_DATABASE_URL (defaults to
 * the docker-compose.test.yml service at the repo root). Start it with:
 *   docker compose -f docker-compose.test.yml up -d
 */

const connectionString =
  process.env["PG_ACCESS_TEST_DATABASE_URL"] ??
  "postgres://pgaccess:pgaccess@localhost:54329/pg_access_test";

describe("asUser() testing a defineAuth() config end-to-end", () => {
  const pool = new pg.Pool({ connectionString });
  const owner1 = { user_id: randomUUID() };
  const owner2 = { user_id: randomUUID() };

  beforeAll(async () => {
    try {
      await pool.query("select 1");
    } catch (error) {
      throw new Error(
        `Could not reach the test database at ${connectionString}. ` +
          "Start it with: docker compose -f docker-compose.test.yml up -d",
        { cause: error },
      );
    }

    await createSupabaseAuthStub(pool);

    await pool.query('drop table if exists "testing_pkg_notes" cascade;');
    await pool.query(`
      create table "testing_pkg_notes" (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        body text not null
      );
    `);

    await pool.query("drop role if exists authenticated;");
    await pool.query("create role authenticated nologin noinherit;");

    const auth = defineAuth({
      testing_pkg_notes: { rows: { select: owner("user_id"), delete: owner("user_id") } },
    });
    await pool.query(compile(auth).sql);

    await pool.query("grant usage on schema public, auth to authenticated;");
    await pool.query('grant select, delete on "testing_pkg_notes" to authenticated;');
    await pool.query("grant execute on function auth.uid() to authenticated;");
    await pool.query("grant execute on function auth.jwt() to authenticated;");

    await pool.query('insert into "testing_pkg_notes" (user_id, body) values ($1, $2), ($3, $4);', [
      owner1.user_id,
      "owner1's note",
      owner2.user_id,
      "owner2's note",
    ]);
  });

  afterAll(async () => {
    await pool.query('drop table if exists "testing_pkg_notes" cascade;');
    await pool.query("drop owned by authenticated;");
    await pool.query("drop role if exists authenticated;");
    await pool.query("drop schema if exists auth cascade;");
    await pool.end();
  });

  it("only returns rows owned by the simulated user", async () => {
    const rows = await asUser(pool, { claims: { sub: owner1.user_id } }, async (client) => {
      const result = await client.query('select body from "testing_pkg_notes" order by body;');
      return result.rows;
    });

    expect(rows).toEqual([{ body: "owner1's note" }]);
  });

  it("returns no rows for an unauthenticated request", async () => {
    const rows = await asUser(pool, {}, async (client) => {
      const result = await client.query('select body from "testing_pkg_notes";');
      return result.rows;
    });

    expect(rows).toEqual([]);
  });

  it("rolls back afterward: a write made inside asUser() doesn't persist", async () => {
    const rowCountInsideTransaction = await asUser(
      pool,
      { claims: { sub: owner1.user_id } },
      async (client) => {
        const result = await client.query('delete from "testing_pkg_notes" where user_id = $1;', [
          owner1.user_id,
        ]);
        return result.rowCount;
      },
    );
    // The delete really did happen (and was permitted by the delete
    // policy) inside the transaction...
    expect(rowCountInsideTransaction).toBe(1);

    // ...but asUser() always rolls back, so it never actually took effect.
    const remaining = await pool.query('select count(*)::int from "testing_pkg_notes";');
    expect(remaining.rows[0]?.count).toBe(2);
  });
});
