import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runGenerate } from "../../src/commands/generate.js";

/**
 * Proves `runGenerate()`'s `databaseUrl` option end-to-end against a real
 * server: an unchanged policy produces no migration at all, a policy removed
 * from the config is dropped, and applying the generated SQL actually
 * reconciles the database. The `ALTER POLICY` path for a drifted expression
 * is covered (with the Supabase auth stub it needs) in @pg-access/postgres's
 * plan-policy-changes integration suite.
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

  const writeConfig = async (body: string) => {
    await writeFile(
      path.join(cwd, "pgaccess.config.ts"),
      `import { defineAuth, publicAccess } from "@pg-access/core";\nexport default defineAuth(${body});`,
    );
  };

  it("drops a removed policy, leaves an unchanged one untouched, then no-ops", async () => {
    await writeConfig(
      `{ cli_generate_target: { rows: { select: publicAccess(), delete: publicAccess() } } }`,
    );
    const first = await runGenerate({ cwd, now: new Date("2026-08-19T14:03:07Z") });
    if (first.filePath === null) throw new Error("expected a first migration");
    await pool.query(await readFile(first.filePath, "utf8"));

    // `delete` removed; `select` unchanged.
    await writeConfig(`{ cli_generate_target: { rows: { select: publicAccess() } } }`);
    const second = await runGenerate({
      cwd,
      databaseUrl: connectionString,
      now: new Date("2026-08-19T14:05:00Z"),
    });
    if (second.filePath === null) throw new Error("expected a second migration");

    expect(second.changes).toEqual(
      expect.arrayContaining([
        {
          table: "cli_generate_target",
          operation: "select",
          name: "cli_generate_target_select",
          kind: "noop",
        },
        {
          table: "cli_generate_target",
          operation: "delete",
          name: "cli_generate_target_delete",
          kind: "drop",
        },
      ]),
    );

    const sql = await readFile(second.filePath, "utf8");
    expect(sql).toContain('drop policy if exists "cli_generate_target_delete"');
    expect(sql).not.toContain('policy "cli_generate_target_select"');

    await pool.query(sql);
    const remaining = await pool.query(
      "select policyname from pg_policies where schemaname = 'public' and tablename = $1",
      ["cli_generate_target"],
    );
    expect(remaining.rows).toEqual([{ policyname: "cli_generate_target_select" }]);

    // Nothing left to reconcile.
    const third = await runGenerate({
      cwd,
      databaseUrl: connectionString,
      now: new Date("2026-08-19T14:07:00Z"),
    });
    expect(third.filePath).toBeNull();
    expect(third.changes.every((change) => change.kind === "noop")).toBe(true);
  });

  it("--format typeorm puts the diff in up() and what undoes it in down()", async () => {
    await writeConfig(
      `{ cli_generate_target: { rows: { select: publicAccess(), delete: publicAccess() } } }`,
    );
    const first = await runGenerate({ cwd, now: new Date("2026-08-19T14:03:07Z") });
    if (first.filePath === null) throw new Error("expected a first migration");
    await pool.query(await readFile(first.filePath, "utf8"));

    await writeConfig(`{ cli_generate_target: { rows: { select: publicAccess() } } }`);
    const result = await runGenerate({
      cwd,
      format: "typeorm",
      databaseUrl: connectionString,
      now: new Date("2026-08-19T14:05:00Z"),
    });
    if (result.filePath === null) throw new Error("expected a typeorm migration");

    expect(path.basename(result.filePath)).toBe("1787148300000-PgAccess.ts");

    const [up, down] = result.contents.split("public async down(");
    expect(up).toContain('drop policy if exists "cli_generate_target_delete"');
    expect(up).not.toContain("cli_generate_target_select");
    expect(down).toContain('create policy "cli_generate_target_delete"');
    expect(down).toContain("for delete");
  });
});
