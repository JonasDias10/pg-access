import { defineAuth, publicAccess } from "@pg-access/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../../src/compiler/compiler.js";
import { diffPolicies } from "../../src/diff/diff-policies.js";
import { listManagedPolicies } from "../../src/introspect/list-managed-policies.js";

/**
 * Proves `listManagedPolicies()` reads real `pg_policies` correctly, not
 * just a mocked client, and that `diffPolicies()` combined with it produces
 * the right verdict against an actual server: an applied-but-no-longer-
 * declared policy is orphaned, a declared-but-not-yet-applied one is
 * missing, and a hand-written policy that doesn't match pg-access's naming
 * convention is invisible to both.
 *
 * Requires a database reachable at PG_ACCESS_TEST_DATABASE_URL (defaults to
 * the docker-compose.test.yml service). Start it with:
 *   docker compose -f docker-compose.test.yml up -d
 */

const connectionString =
  process.env["PG_ACCESS_TEST_DATABASE_URL"] ??
  "postgres://pgaccess:pgaccess@localhost:54329/pg_access_test";

describe("listManagedPolicies + diffPolicies against real PostgreSQL", () => {
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

    await pool.query('drop table if exists "policy_diff_target" cascade;');
    await pool.query(`
      create table "policy_diff_target" (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null
      );
    `);
  });

  afterAll(async () => {
    await pool.query('drop table if exists "policy_diff_target" cascade;');
    await pool.end();
  });

  it("distinguishes missing, orphaned, and unrelated policies", async () => {
    // The config declares select and update, but only select actually gets
    // applied below - update is deliberately left unapplied to produce a
    // "missing" result. publicAccess() is used purely because it needs no
    // auth schema/role setup to be a valid CREATE POLICY, not for what it
    // means semantically - this test is about introspection, not RLS
    // behavior (that's rls.integration.test.ts's job).
    const auth = defineAuth({
      policy_diff_target: {
        rows: {
          select: publicAccess(),
          update: publicAccess(),
        },
      },
    });
    const { sql: selectOnly } = compile(
      defineAuth({ policy_diff_target: { rows: { select: publicAccess() } } }),
    );
    await pool.query(selectOnly);

    // A policy pg-access once created for `delete` that's since been
    // removed from the config - this is what "orphaned" should catch.
    await pool.query(
      'create policy "policy_diff_target_delete" on "policy_diff_target" for delete to public using (true);',
    );
    // A hand-written policy that doesn't match pg-access's naming
    // convention at all - neither function should ever mention this one.
    await pool.query(
      'create policy "policy_diff_target_custom_rule" on "policy_diff_target" for select to public using (true);',
    );

    const managed = await listManagedPolicies(pool, ["policy_diff_target"]);
    expect(managed).toEqual(
      expect.arrayContaining([
        { table: "policy_diff_target", operation: "select", name: "policy_diff_target_select" },
        { table: "policy_diff_target", operation: "delete", name: "policy_diff_target_delete" },
      ]),
    );
    expect(managed.map((p) => p.name)).not.toContain("policy_diff_target_custom_rule");

    const diff = diffPolicies(auth, managed);
    expect(diff).toEqual({
      missing: [{ table: "policy_diff_target", name: "policy_diff_target_update" }],
      orphaned: [{ table: "policy_diff_target", name: "policy_diff_target_delete" }],
    });
  });
});
