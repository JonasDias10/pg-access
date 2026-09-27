import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGenerate } from "../../src/commands/generate.js";

// Nested under the package root (not os.tmpdir()) so that bare-specifier
// resolution of "@pg-access/core" from the config file under test walks up
// to this package's own node_modules, same as it would in a real project.
const packageRoot = path.join(import.meta.dirname, "..", "..");

describe("runGenerate", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(packageRoot, ".tmp-generate-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("writes a migration to supabase/migrations by default", async () => {
    await writeFile(
      path.join(cwd, "pgaccess.config.ts"),
      `import { defineAuth, owner } from "@pg-access/core";
export default defineAuth({ projects: { rows: { select: owner("user_id") } } });`,
    );

    const result = await runGenerate({ cwd, now: new Date("2026-08-19T14:03:07Z") });

    const expectedPath = path.join(cwd, "supabase", "migrations", "20260819140307_pg_access.sql");
    expect(result.filePath).toBe(expectedPath);
    const written = await readFile(expectedPath, "utf8");
    expect(written).toContain('create policy "projects_select"');
  });

  it("writes into a custom --out directory", async () => {
    await writeFile(
      path.join(cwd, "pgaccess.config.ts"),
      `import { defineAuth, owner } from "@pg-access/core";
export default defineAuth({ projects: { rows: { select: owner("user_id") } } });`,
    );

    const result = await runGenerate({
      cwd,
      out: "db/migrations",
      now: new Date("2026-08-19T14:03:07Z"),
    });

    expect(result.filePath).toBe(
      path.join(cwd, "db", "migrations", "20260819140307_pg_access.sql"),
    );
  });

  it("returns an empty changes list and always writes a file when no database is given", async () => {
    await writeFile(
      path.join(cwd, "pgaccess.config.ts"),
      `import { defineAuth, owner } from "@pg-access/core";
export default defineAuth({ projects: { rows: { select: owner("user_id") } } });`,
    );

    const result = await runGenerate({ cwd, now: new Date("2026-08-19T14:03:07Z") });

    expect(result.changes).toEqual([]);
    expect(result.filePath).not.toBeNull();
  });

  it("throws a clear error when no config file is found", async () => {
    await expect(runGenerate({ cwd })).rejects.toThrow(/No pgaccess config found/);
  });

  it("throws a clear error when an explicit --config path doesn't exist", async () => {
    await expect(runGenerate({ cwd, config: "missing.config.ts" })).rejects.toThrow(
      /Config file not found: missing\.config\.ts/,
    );
  });

  it("--format typeorm writes a migration class into src/migrations by default", async () => {
    await writeFile(
      path.join(cwd, "pgaccess.config.ts"),
      `import { defineAuth, owner } from "@pg-access/core";
export default defineAuth({ projects: { rows: { select: owner("user_id") } } });`,
    );

    const result = await runGenerate({
      cwd,
      format: "typeorm",
      now: new Date("2026-08-19T14:03:07.123Z"),
    });

    const expectedPath = path.join(cwd, "src", "migrations", "1787148187123-PgAccess.ts");
    expect(result.filePath).toBe(expectedPath);
    const written = await readFile(expectedPath, "utf8");
    expect(written).toContain("export class PgAccess1787148187123 implements MigrationInterface");
    expect(written).toContain('create policy "projects_select"');
    expect(written).toContain("public async down(queryRunner: QueryRunner)");
    expect(written).toBe(result.contents);
  });

  it("rejects an unknown --format before touching the config", async () => {
    await expect(runGenerate({ cwd, format: "prisma" })).rejects.toThrow(
      /Unknown --format "prisma"\. Expected one of: sql, typeorm\./,
    );
  });

  describe("snapshot", () => {
    const writeConfig = (rows: string) =>
      writeFile(
        path.join(cwd, "pgaccess.config.ts"),
        `import { defineAuth, owner, publicAccess } from "@pg-access/core";
export default defineAuth({ projects: { rows: ${rows} } });`,
      );

    it("with no snapshot yet, re-emits every policy and creates the snapshot next to the config", async () => {
      await writeConfig(`{ select: owner("user_id") }`);

      const result = await runGenerate({ cwd, now: new Date("2026-08-19T14:03:07Z") });

      expect(result.diffedAgainst).toBe("none");
      expect(result.contents).toContain('drop policy if exists "projects_select"');
      expect(result.snapshotPath).toBe(path.join(cwd, "pgaccess.snapshot.json"));
      expect(result.snapshotWritten).toBe(true);
      const snapshot = JSON.parse(await readFile(result.snapshotPath, "utf8"));
      expect(snapshot.policies.map((policy: { name: string }) => policy.name)).toEqual([
        "projects_select",
      ]);
    });

    it("writes no migration and leaves the snapshot alone when nothing changed", async () => {
      await writeConfig(`{ select: owner("user_id") }`);
      await runGenerate({ cwd, now: new Date("2026-08-19T14:03:07Z") });

      const result = await runGenerate({ cwd, now: new Date("2026-08-19T14:05:00Z") });

      expect(result.diffedAgainst).toBe("snapshot");
      expect(result.filePath).toBeNull();
      expect(result.snapshotWritten).toBe(false);
      expect(result.changes).toEqual([
        { table: "projects", operation: "select", name: "projects_select", kind: "noop" },
      ]);
    });

    it("emits only what changed since the snapshot, then records the new state", async () => {
      await writeConfig(`{ select: owner("user_id"), delete: owner("user_id") }`);
      await runGenerate({ cwd, now: new Date("2026-08-19T14:03:07Z") });

      await writeConfig(`{ select: publicAccess(), delete: owner("user_id") }`);
      const result = await runGenerate({ cwd, now: new Date("2026-08-19T14:05:00Z") });

      expect(result.contents).toContain('alter policy "projects_select"');
      expect(result.contents).not.toContain("create policy");
      expect(result.contents).not.toContain("projects_delete");
      expect(result.snapshotWritten).toBe(true);

      const again = await runGenerate({ cwd, now: new Date("2026-08-19T14:07:00Z") });
      expect(again.filePath).toBeNull();
    });

    it("gives --format typeorm a down() that restores the snapshot's previous policy", async () => {
      await writeConfig(`{ select: owner("user_id") }`);
      await runGenerate({ cwd, now: new Date("2026-08-19T14:03:07Z") });

      await writeConfig(`{ select: owner("owner_id") }`);
      const result = await runGenerate({
        cwd,
        format: "typeorm",
        now: new Date("2026-08-19T14:05:00Z"),
      });

      const [up, down] = result.contents.split("public async down(");
      expect(up).toContain('"owner_id" = (select auth.uid())');
      expect(down).toContain('alter policy "projects_select"');
      expect(down).toContain('"user_id" = (select auth.uid())');
    });

    it("reads and writes an explicit --snapshot path", async () => {
      await writeConfig(`{ select: owner("user_id") }`);

      const result = await runGenerate({
        cwd,
        snapshot: "db/pg-access.json",
        now: new Date("2026-08-19T14:03:07Z"),
      });

      expect(result.snapshotPath).toBe(path.join(cwd, "db", "pg-access.json"));
    });

    it("refuses to diff against a snapshot it can't read", async () => {
      await writeConfig(`{ select: owner("user_id") }`);
      await writeFile(path.join(cwd, "pgaccess.snapshot.json"), '{ "version": 99 }');

      await expect(runGenerate({ cwd })).rejects.toThrow(
        /pgaccess\.snapshot\.json: Unsupported pg-access snapshot version 99.*pg-access baseline/,
      );
    });
  });
});
