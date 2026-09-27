import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BaselineDriftError, runBaseline } from "../../src/commands/baseline.js";
import { runGenerate } from "../../src/commands/generate.js";

/**
 * Proves the snapshot lifecycle around a real database: `baseline` records
 * the snapshot only when the database matches the config, and
 * `generate --database-url` keeps the snapshot current so the next offline
 * `generate` diffs from the right place.
 *
 * Requires a database reachable at PG_ACCESS_TEST_DATABASE_URL (defaults to
 * the docker-compose.test.yml service at the repo root). Start it with:
 *   docker compose -f docker-compose.test.yml up -d
 */

const connectionString =
  process.env["PG_ACCESS_TEST_DATABASE_URL"] ??
  "postgres://pgaccess:pgaccess@localhost:54329/pg_access_test";

const TABLE = "cli_baseline_target";

describe("snapshot lifecycle against a real PostgreSQL database", () => {
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
  });

  afterAll(async () => {
    await pool.query(`drop table if exists "${TABLE}" cascade;`);
    await pool.end();
  });

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "pg-access-cli-baseline-"));
    await pool.query(`drop table if exists "${TABLE}" cascade;`);
    await pool.query(`create table "${TABLE}" (id uuid primary key default gen_random_uuid());`);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const writeConfig = (rows: string) =>
    writeFile(
      path.join(cwd, "pgaccess.config.ts"),
      `import { defineAuth, publicAccess } from "@pg-access/core";\nexport default defineAuth({ ${TABLE}: { rows: ${rows} } });`,
    );

  const applyGenerated = async (filePath: string | null) => {
    if (filePath === null) throw new Error("expected a migration");
    await pool.query(await readFile(filePath, "utf8"));
  };

  it("baseline refuses a database that doesn't match the config, and writes nothing", async () => {
    await writeConfig(`{ select: publicAccess() }`);

    const attempt = runBaseline({ cwd, databaseUrl: connectionString });

    await expect(attempt).rejects.toBeInstanceOf(BaselineDriftError);
    await expect(attempt).rejects.toMatchObject({
      drift: [expect.objectContaining({ name: `${TABLE}_select`, kind: "create" })],
    });
    await expect(readFile(path.join(cwd, "pgaccess.snapshot.json"))).rejects.toThrow(/ENOENT/);
  });

  it("baseline records a matching database, and offline generate diffs from it", async () => {
    // Policies applied before this project had a snapshot.
    await writeConfig(`{ select: publicAccess(), delete: publicAccess() }`);
    const first = await runGenerate({ cwd, snapshot: "unused.json" });
    await applyGenerated(first.filePath);

    const baseline = await runBaseline({ cwd, databaseUrl: connectionString });
    expect(baseline.snapshotWritten).toBe(true);

    await writeConfig(`{ select: publicAccess() }`);
    const next = await runGenerate({ cwd, now: new Date("2026-08-19T14:05:00Z") });

    expect(next.diffedAgainst).toBe("snapshot");
    expect(next.changes.map((change) => change.kind)).toEqual(["noop", "drop"]);
    await applyGenerated(next.filePath);

    const settled = await runGenerate({ cwd, databaseUrl: connectionString });
    expect(settled.filePath).toBeNull();
  });

  it("generate --database-url also brings the snapshot up to date", async () => {
    await writeConfig(`{ select: publicAccess() }`);

    const live = await runGenerate({ cwd, databaseUrl: connectionString });
    expect(live.diffedAgainst).toBe("database");
    expect(live.snapshotWritten).toBe(true);
    await applyGenerated(live.filePath);

    const offline = await runGenerate({ cwd });
    expect(offline.diffedAgainst).toBe("snapshot");
    expect(offline.filePath).toBeNull();
  });
});
