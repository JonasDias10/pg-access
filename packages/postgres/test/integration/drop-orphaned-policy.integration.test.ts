import { defineAuth, publicAccess } from "@pg-access/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../../src/compiler/compiler.js";
import { listManagedPolicies } from "../../src/introspect/list-managed-policies.js";

/**
 * Proves the full round trip for real: apply a migration with two
 * policies, remove one from the config, introspect the live database, and
 * regenerate with `existingPolicies` - the second migration's DROP for the
 * removed policy must actually take effect when applied, not just appear
 * in the generated SQL string.
 *
 * Requires a database reachable at PG_ACCESS_TEST_DATABASE_URL (defaults to
 * the docker-compose.test.yml service). Start it with:
 *   docker compose -f docker-compose.test.yml up -d
 */

const connectionString =
  process.env["PG_ACCESS_TEST_DATABASE_URL"] ??
  "postgres://pgaccess:pgaccess@localhost:54329/pg_access_test";

describe("compile() with existingPolicies against real PostgreSQL", () => {
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

    await pool.query('drop table if exists "orphan_drop_target" cascade;');
    await pool.query(
      'create table "orphan_drop_target" (id uuid primary key default gen_random_uuid());',
    );
  });

  afterAll(async () => {
    await pool.query('drop table if exists "orphan_drop_target" cascade;');
    await pool.end();
  });

  it("actually drops a policy removed from the config once applied", async () => {
    // publicAccess() needs no auth schema/role setup, this test is about
    // orphan-dropping, not RLS behavior.
    const firstAuth = defineAuth({
      orphan_drop_target: {
        rows: {
          select: publicAccess(),
          delete: publicAccess(),
        },
      },
    });
    await pool.query(compile(firstAuth).sql);

    const beforeNames = (await listManagedPolicies(pool, ["orphan_drop_target"])).map(
      (p) => p.name,
    );
    expect(beforeNames.sort()).toEqual(["orphan_drop_target_delete", "orphan_drop_target_select"]);

    // `delete` is removed from the config - regenerating without
    // `existingPolicies` would leave it in place; with it, it's dropped.
    const secondAuth = defineAuth({
      orphan_drop_target: { rows: { select: publicAccess() } },
    });
    const existingPolicies = await listManagedPolicies(pool, ["orphan_drop_target"]);
    const { sql } = compile(secondAuth, { existingPolicies });
    expect(sql).toContain('drop policy if exists "orphan_drop_target_delete"');
    await pool.query(sql);

    const afterNames = (await listManagedPolicies(pool, ["orphan_drop_target"])).map((p) => p.name);
    expect(afterNames).toEqual(["orphan_drop_target_select"]);
  });
});
