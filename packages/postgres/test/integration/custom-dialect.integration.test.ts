import { randomUUID } from "node:crypto";
import { defineAuth, owner } from "@pg-access/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../../src/compiler/compiler.js";
import type { Dialect } from "../../src/dialect/postgres.js";

/**
 * Proves the dialect seam actually works end-to-end, not just that
 * `postgresDialect` happens to produce correct SQL. This project's whole
 * "core doesn't know about Supabase" claim is only true in practice if a
 * non-Supabase dialect can drive the exact same compiler, so this runs
 * against a database with no `auth` schema and no JWTs at all; just a
 * plain session variable, the kind of thing a non-Supabase Postgres app
 * would realistically use.
 */

const connectionString =
  process.env["PG_ACCESS_TEST_DATABASE_URL"] ??
  "postgres://pgaccess:pgaccess@localhost:54329/pg_access_test";

const APP_ROLE = "app_user";

const plainPostgresDialect: Dialect = {
  // nullif(..., '') matters here, not just style: with connection pooling
  // (or, as in this test, a reused pg.Pool connection), a custom GUC that
  // was set in an earlier, since-rolled-back transaction on the same
  // physical connection can read back as '' rather than truly unset,
  // and ''::uuid throws instead of comparing as NULL like an
  // unauthenticated request should.
  currentUserIdExpression: "(select nullif(current_setting('app.user_id', true), '')::uuid)",
  authenticatedRole: APP_ROLE,
  publicRole: "public",
  roleExpression: (roleLiteral) => `(select current_setting('app.role', true)) = ${roleLiteral}`,
};

describe("a custom, non-Supabase Dialect against real PostgreSQL", () => {
  const pool = new pg.Pool({ connectionString });
  const owner1 = randomUUID();
  const owner2 = randomUUID();

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

    await pool.query('drop table if exists "tickets" cascade;');
    await pool.query(`
      create table "tickets" (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        subject text not null
      );
    `);

    await pool.query(`drop role if exists ${APP_ROLE};`);
    await pool.query(`create role ${APP_ROLE} nologin noinherit;`);

    const auth = defineAuth({ tickets: { rows: { select: owner("user_id") } } });
    const { sql } = compile(auth, { dialect: plainPostgresDialect });
    // No auth.uid(), no auth.jwt() anywhere in this SQL; proves the
    // compiled policy really is dialect-driven, not hardcoded to Supabase.
    expect(sql).not.toContain("auth.");
    await pool.query(sql);

    await pool.query(`grant select on "tickets" to ${APP_ROLE};`);

    await pool.query('insert into "tickets" (user_id, subject) values ($1, $2), ($3, $4);', [
      owner1,
      "ticket from owner1",
      owner2,
      "ticket from owner2",
    ]);
  });

  afterAll(async () => {
    await pool.query('drop table if exists "tickets" cascade;');
    await pool.query(`drop owned by ${APP_ROLE};`);
    await pool.query(`drop role if exists ${APP_ROLE};`);
    await pool.end();
  });

  async function asUser<T>(userId: string | null, run: (client: pg.PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${APP_ROLE};`);
      if (userId) {
        await client.query("select set_config('app.user_id', $1, true);", [userId]);
      }
      return await run(client);
    } finally {
      await client.query("rollback");
      client.release();
    }
  }

  it("owner() scoped by a plain session GUC, not a JWT, still filters rows correctly", async () => {
    const rows = await asUser(owner1, async (client) => {
      const result = await client.query('select subject from "tickets";');
      return result.rows;
    });

    expect(rows).toEqual([{ subject: "ticket from owner1" }]);
  });

  it("a session with no app.user_id set sees no rows", async () => {
    const rows = await asUser(null, async (client) => {
      const result = await client.query('select subject from "tickets";');
      return result.rows;
    });

    expect(rows).toEqual([]);
  });
});
