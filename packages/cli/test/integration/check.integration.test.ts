import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCheck } from "../../src/commands/check.js";

/**
 * Proves `runCheck()` end-to-end against a real database: not just that
 * `planPolicyChanges()` computes the right verdict (that's already covered,
 * with a real server too, in @pg-access/postgres's own integration suite),
 * but that this package's own plumbing - loading the config, opening a real
 * `pg.Pool`, holding one session, closing it again - actually works.
 *
 * Requires a database reachable at PG_ACCESS_TEST_DATABASE_URL (defaults to
 * the docker-compose.test.yml service at the repo root). Start it with:
 *   docker compose -f docker-compose.test.yml up -d
 */

const connectionString =
  process.env["PG_ACCESS_TEST_DATABASE_URL"] ??
  "postgres://pgaccess:pgaccess@localhost:54329/pg_access_test";

describe("runCheck against a real PostgreSQL database", () => {
  const pool = new pg.Pool({ connectionString });
  let cwd: string;

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

    await pool.query('drop table if exists "cli_check_target" cascade;');
    await pool.query(`
      create table "cli_check_target" (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null
      );
    `);
  });

  afterAll(async () => {
    await pool.query('drop table if exists "cli_check_target" cascade;');
    await pool.end();
  });

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "pg-access-cli-check-"));
    await pool.query('drop policy if exists "cli_check_target_select" on "cli_check_target";');
    await pool.query('drop policy if exists "cli_check_target_delete" on "cli_check_target";');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const configFile = `import { defineAuth, publicAccess } from "@pg-access/core";
export default defineAuth({ cli_check_target: { rows: { select: publicAccess() } } });`;

  it("reports no drift once the database matches the config", async () => {
    await writeFile(path.join(cwd, "pgaccess.config.ts"), configFile);
    await pool.query(
      'create policy "cli_check_target_select" on "cli_check_target" for select to public using (true);',
    );

    const result = await runCheck({ cwd, databaseUrl: connectionString });

    expect(result.missing).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.orphaned).toEqual([]);
  });

  it("reports a missing policy that the config declares but nothing applied yet", async () => {
    await writeFile(path.join(cwd, "pgaccess.config.ts"), configFile);

    const result = await runCheck({ cwd, databaseUrl: connectionString });

    expect(result.missing).toEqual([
      {
        table: "cli_check_target",
        operation: "select",
        name: "cli_check_target_select",
        kind: "create",
      },
    ]);
    expect(result.changed).toEqual([]);
    expect(result.orphaned).toEqual([]);
  });

  it("reports a changed policy whose applied definition drifted from the config", async () => {
    await writeFile(path.join(cwd, "pgaccess.config.ts"), configFile);
    // Same name/command, different USING - publicAccess() compiles to `using (true)`.
    await pool.query(
      'create policy "cli_check_target_select" on "cli_check_target" for select to public using (user_id is not null);',
    );

    const result = await runCheck({ cwd, databaseUrl: connectionString });

    expect(result.missing).toEqual([]);
    expect(result.changed).toEqual([
      {
        table: "cli_check_target",
        operation: "select",
        name: "cli_check_target_select",
        kind: "alter",
      },
    ]);
    expect(result.orphaned).toEqual([]);
  });

  it("reports an orphaned policy that's applied but no longer declared", async () => {
    await writeFile(path.join(cwd, "pgaccess.config.ts"), configFile);
    await pool.query(
      'create policy "cli_check_target_select" on "cli_check_target" for select to public using (true);',
    );
    await pool.query(
      'create policy "cli_check_target_delete" on "cli_check_target" for delete to public using (true);',
    );

    const result = await runCheck({ cwd, databaseUrl: connectionString });

    expect(result.missing).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.orphaned).toEqual([
      {
        table: "cli_check_target",
        operation: "delete",
        name: "cli_check_target_delete",
        kind: "drop",
      },
    ]);
  });
});
