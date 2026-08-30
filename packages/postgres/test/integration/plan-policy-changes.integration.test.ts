import { defineAuth, or, owner, publicAccess, role } from "@pg-access/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { compile } from "../../src/compiler/compiler.js";
import { planPolicyChanges } from "../../src/diff/plan-policy-changes.js";
import { listManagedPolicies } from "../../src/introspect/list-managed-policies.js";

/**
 * Proves `planPolicyChanges()` against a real server: it normalizes the
 * config's policies through PostgreSQL itself (in a rolled-back
 * transaction) so an unchanged policy is recognised as unchanged and
 * produces no SQL, a drifted `USING` becomes an `ALTER POLICY` that
 * actually reconciles once applied, a new operation becomes a `CREATE`, and
 * a removed one becomes a `DROP`.
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

describe("planPolicyChanges against real PostgreSQL", () => {
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

    await pool.query('drop table if exists "plan_target" cascade;');
    await pool.query(`
      create table "plan_target" (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        team_id uuid
      );
    `);
  });

  afterAll(async () => {
    await pool.query('drop table if exists "plan_target" cascade;');
    await pool.end();
  });

  beforeEach(async () => {
    for (const op of ["select", "insert", "update", "delete"]) {
      await pool.query(`drop policy if exists "plan_target_${op}" on "plan_target";`);
    }
  });

  const withSession = async <T>(fn: (session: pg.PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  };

  it("produces no statements when the applied policy already matches the config", async () => {
    const auth = defineAuth({ plan_target: { rows: { select: owner("user_id") } } });
    await pool.query(compile(auth).sql);

    const plan = await withSession((session) => planPolicyChanges(session, auth));

    expect(plan.changes).toEqual([
      { table: "plan_target", operation: "select", name: "plan_target_select", kind: "noop" },
    ]);
    expect(plan.sql).toBe("");
  });

  it("emits an ALTER (not a drop+recreate) for a drifted USING, and it reconciles", async () => {
    await pool.query(
      compile(defineAuth({ plan_target: { rows: { select: owner("user_id") } } })).sql,
    );

    const next = defineAuth({ plan_target: { rows: { select: owner("team_id") } } });
    const plan = await withSession((session) => planPolicyChanges(session, next));

    expect(plan.changes).toEqual([
      { table: "plan_target", operation: "select", name: "plan_target_select", kind: "alter" },
    ]);
    expect(plan.sql).toContain('alter policy "plan_target_select"');
    expect(plan.sql).not.toContain("create policy");
    expect(plan.sql).not.toContain("drop policy");

    await pool.query(plan.sql);

    const [applied] = await listManagedPolicies(pool, ["plan_target"]);
    expect(applied?.using).toContain("team_id");

    const settled = await withSession((session) => planPolicyChanges(session, next));
    expect(settled.sql).toBe("");
  });

  it("CREATEs a newly declared operation and leaves the existing one alone", async () => {
    await pool.query(
      compile(defineAuth({ plan_target: { rows: { select: owner("user_id") } } })).sql,
    );

    const next = defineAuth({
      plan_target: { rows: { select: owner("user_id"), insert: owner("user_id") } },
    });
    const plan = await withSession((session) => planPolicyChanges(session, next));

    expect(plan.changes).toEqual([
      { table: "plan_target", operation: "select", name: "plan_target_select", kind: "noop" },
      { table: "plan_target", operation: "insert", name: "plan_target_insert", kind: "create" },
    ]);
    expect(plan.sql).toContain('create policy "plan_target_insert"');
    expect(plan.sql).not.toContain("plan_target_select");
  });

  it("recognises an unchanged or(owner, role) policy despite Postgres reformatting its SQL", async () => {
    // The shape examples/supabase uses: the compiled `auth.jwt() -> ... ->> 'role'`
    // subexpression is exactly the kind of SQL Postgres rewrites on the way into
    // pg_policies, so a naive string compare would report false drift here.
    const auth = defineAuth({
      plan_target: { rows: { select: or(owner("user_id"), role("admin")) } },
    });
    await pool.query(compile(auth).sql);

    const unchanged = await withSession((session) => planPolicyChanges(session, auth));
    expect(unchanged.sql).toBe("");

    const moved = defineAuth({
      plan_target: { rows: { select: or(owner("team_id"), role("admin")) } },
    });
    const plan = await withSession((session) => planPolicyChanges(session, moved));
    expect(plan.changes).toEqual([
      { table: "plan_target", operation: "select", name: "plan_target_select", kind: "alter" },
    ]);
  });

  it("DROPs a policy removed from the config once applied", async () => {
    await pool.query(
      compile(
        defineAuth({
          plan_target: { rows: { select: owner("user_id"), delete: publicAccess() } },
        }),
      ).sql,
    );

    const next = defineAuth({ plan_target: { rows: { select: owner("user_id") } } });
    const plan = await withSession((session) => planPolicyChanges(session, next));

    expect(plan.changes).toContainEqual({
      table: "plan_target",
      operation: "delete",
      name: "plan_target_delete",
      kind: "drop",
    });
    expect(plan.sql).toContain('drop policy if exists "plan_target_delete" on "plan_target";');

    await pool.query(plan.sql);
    const names = (await listManagedPolicies(pool, ["plan_target"])).map((p) => p.name);
    expect(names).toEqual(["plan_target_select"]);
  });

  it("DROPs every managed policy when a table is kept in the config but emptied to rows: {}", async () => {
    await pool.query(
      compile(
        defineAuth({
          plan_target: { rows: { select: owner("user_id"), delete: publicAccess() } },
        }),
      ).sql,
    );

    const emptied = defineAuth({ plan_target: { rows: {} } });
    const plan = await withSession((session) => planPolicyChanges(session, emptied));

    expect(plan.changes.map((change) => change.kind)).toEqual(["drop", "drop"]);
    expect(plan.sql).toContain('drop policy if exists "plan_target_select" on "plan_target";');
    expect(plan.sql).toContain('drop policy if exists "plan_target_delete" on "plan_target";');

    await pool.query(plan.sql);
    expect(await listManagedPolicies(pool, ["plan_target"])).toEqual([]);
  });
});
