import { defineAuth, or, owner, publicAccess, role } from "@pg-access/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { compile } from "../../src/compiler/compiler.js";
import { planPolicyChanges } from "../../src/diff/plan-policy-changes.js";
import { listManagedPolicies } from "../../src/introspect/list-managed-policies.js";
import { createSnapshot, planSnapshotChanges } from "../../src/snapshot/snapshot.js";

/**
 * Proves the offline, snapshot-based diff produces SQL a real database
 * accepts and converges on: after applying `planSnapshotChanges()`'s output,
 * the live `planPolicyChanges()` finds nothing left to do, and its `down`
 * brings the previous config back just as exactly.
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

const TABLE = "snapshot_target";

describe("planSnapshotChanges against real PostgreSQL", () => {
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

  const inSync = async (auth: Parameters<typeof planPolicyChanges>[1]) => {
    const client = await pool.connect();
    try {
      const plan = await planPolicyChanges(client, auth);
      return plan.changes.every((change) => change.kind === "noop");
    } finally {
      client.release();
    }
  };

  const previous = defineAuth({
    [TABLE]: { rows: { select: or(owner("user_id"), role("admin")), delete: publicAccess() } },
  });
  const next = defineAuth({
    [TABLE]: { rows: { select: owner("team_id"), insert: owner("user_id") } },
  });

  it("applies a create + alter + drop from the snapshot and converges with the live diff", async () => {
    await pool.query(compile(previous).sql);

    const plan = planSnapshotChanges(createSnapshot(previous), next);
    expect(plan.changes.map((change) => change.kind).sort()).toEqual(["alter", "create", "drop"]);

    await pool.query(plan.sql);

    expect(await inSync(next)).toBe(true);
  });

  it("rolls back to the previous config", async () => {
    await pool.query(compile(previous).sql);
    const plan = planSnapshotChanges(createSnapshot(previous), next);
    await pool.query(plan.sql);

    await pool.query(plan.down.sql);

    expect(await inSync(previous)).toBe(true);
  });

  it("still applies when a policy the snapshot says is new already exists", async () => {
    // e.g. two branches both added it and the merged snapshot lost one side.
    await pool.query(compile(next).sql);

    const plan = planSnapshotChanges(createSnapshot(defineAuth({ [TABLE]: { rows: {} } })), next);
    await pool.query(plan.sql);

    expect(await inSync(next)).toBe(true);
    expect(await listManagedPolicies(pool, [TABLE])).toHaveLength(2);
  });
});
