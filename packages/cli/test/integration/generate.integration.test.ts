import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runGenerate } from "../../src/commands/generate.js";

/**
 * Proves `runGenerate()`'s `databaseUrl` option end-to-end: the generated
 * migration's DROP for an orphaned policy must actually take effect once
 * applied against a real database, not just appear in the SQL string
 * (that part is already covered, with a real server too, in
 * @pg-access/postgres's own integration suite).
 *
 * Requires a database reachable at PG_ACCESS_TEST_DATABASE_URL (defaults to
 * the docker-compose.test.yml service at the repo root). Start it with:
 *   docker compose -f docker-compose.test.yml up -d
 */

const connectionString =
  process.env["PG_ACCESS_TEST_DATABASE_URL"] ??
  "postgres://pgaccess:pgaccess@localhost:54329/pg_access_test";

describe("runGenerate with databaseUrl against a real PostgreSQL database", () => {
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

    await pool.query('drop table if exists "cli_generate_target" cascade;');
    await pool.query(
      'create table "cli_generate_target" (id uuid primary key default gen_random_uuid());',
    );
  });

  afterAll(async () => {
    await pool.query('drop table if exists "cli_generate_target" cascade;');
    await pool.end();
  });

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "pg-access-cli-generate-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("also drops a policy removed from the config once the migration is applied", async () => {
    await writeFile(
      path.join(cwd, "pgaccess.config.ts"),
      `import { defineAuth, publicAccess } from "@pg-access/core";
export default defineAuth({
  cli_generate_target: { rows: { select: publicAccess(), delete: publicAccess() } },
});`,
    );
    const firstResult = await runGenerate({ cwd, now: new Date("2026-08-19T14:03:07Z") });
    await pool.query(await readFile(firstResult.filePath, "utf8"));

    await writeFile(
      path.join(cwd, "pgaccess.config.ts"),
      `import { defineAuth, publicAccess } from "@pg-access/core";
export default defineAuth({ cli_generate_target: { rows: { select: publicAccess() } } });`,
    );
    const secondResult = await runGenerate({
      cwd,
      databaseUrl: connectionString,
      now: new Date("2026-08-19T14:05:00Z"),
    });

    expect(secondResult.droppedOrphans).toEqual([
      { table: "cli_generate_target", name: "cli_generate_target_delete" },
    ]);
    const sql = await readFile(secondResult.filePath, "utf8");
    expect(sql).toContain('drop policy if exists "cli_generate_target_delete"');

    await pool.query(sql);
    const remaining = await pool.query(
      "select policyname from pg_policies where schemaname = 'public' and tablename = $1",
      ["cli_generate_target"],
    );
    expect(remaining.rows).toEqual([{ policyname: "cli_generate_target_select" }]);
  });
});
