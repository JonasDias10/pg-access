import { defineAuth, or, owner, publicAccess, role } from "@pg-access/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { compile } from "../../src/compiler/compiler.js";
import { planPolicyChanges } from "../../src/diff/plan-policy-changes.js";
import { listManagedPolicies } from "../../src/introspect/list-managed-policies.js";

/**
 * Proves the `down` both `planPolicyChanges()` and `compile()` return puts a
 * real database back exactly where it was before `up`: same managed
 * policies, same `USING` / `WITH CHECK` / roles as PostgreSQL stores them,
 * same RLS state. That is what makes it safe for ORM adapters (TypeORM's
 * `migration:revert`) to run.
 *
 * Requires a database reachable at PG_ACCESS_TEST_DATABASE_URL (defaults to
 * the docker-compose.test.yml service). Start it with:
 *   docker compose -f docker-compose.test.yml up -d
 */

const connectionString =
  process.env["PG_ACCESS_TEST_DATABASE_URL"] ??
  "postgres://pgaccess:pgaccess@localhost:54329/pg_access_test";

const AUTH_SCHEMA_SQL = `
  create schema if not exists auth;
  create or replace function auth.jwt() returns jsonb
  language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
`;

const TABLE = "rollback_target";

describe("rollback against real PostgreSQL", () => {
  const pool = new pg.Pool({ connectionString });

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

    await pool.query(AUTH_SCHEMA_SQL);
    await pool.query("drop role if exists authenticated;");
    await pool.query("create role authenticated nologin noinherit;");
  });

  afterAll(async () => {
    await pool.query(`drop table if exists "${TABLE}" cascade;`);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`drop table if exists "${TABLE}" cascade;`);
    await pool.query(`
      create table "${TABLE}" (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        team_id uuid
      );
    `);
  });

  const withSession = async <T>(fn: (session: pg.PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  };

  const snapshot = async () => {
    const policies = await listManagedPolicies(pool, [TABLE]);
    const rls = await pool.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = $1",
      [TABLE],
    );
    return {
      policies: [...policies].sort((a, b) => a.name.localeCompare(b.name)),
      rls: rls.rows[0]?.relrowsecurity,
    };
  };

  it("undoes a first migration: no managed policies left, RLS back off", async () => {
    const auth = defineAuth({
      [TABLE]: { rows: { select: owner("user_id"), insert: owner("user_id") } },
    });
    const before = await snapshot();

    const plan = await withSession((session) => planPolicyChanges(session, auth));
    await pool.query(plan.sql);
    expect((await snapshot()).policies).toHaveLength(2);

    await pool.query(plan.down.sql);

    expect(await snapshot()).toEqual({ policies: [], rls: false });
    expect(before.rls).toBe(false);
  });

  it("undoes a create + alter + drop together, restoring every policy as it was", async () => {
    await pool.query(
      compile(
        defineAuth({
          [TABLE]: {
            rows: { select: or(owner("user_id"), role("admin")), delete: publicAccess() },
          },
        }),
      ).sql,
    );
    const before = await snapshot();

    const next = defineAuth({
      [TABLE]: { rows: { select: owner("team_id"), insert: owner("user_id") } },
    });
    const plan = await withSession((session) => planPolicyChanges(session, next));
    expect(plan.changes.map((change) => change.kind).sort()).toEqual(["alter", "create", "drop"]);

    await pool.query(plan.sql);
    expect(await snapshot()).not.toEqual(before);

    await pool.query(plan.down.sql);

    expect(await snapshot()).toEqual(before);
  });

  it("compile() with existingPolicies also rolls back to the previous definitions", async () => {
    const previous = defineAuth({
      [TABLE]: { rows: { select: owner("user_id"), delete: owner("user_id") } },
    });
    await pool.query(compile(previous).sql);
    const before = await snapshot();

    const next = defineAuth({ [TABLE]: { rows: { select: owner("team_id") } } });
    const { sql, down } = compile(next, {
      existingPolicies: await listManagedPolicies(pool, [TABLE]),
    });

    await pool.query(sql);
    await pool.query(down.sql);

    expect(await snapshot()).toEqual(before);
  });
});
