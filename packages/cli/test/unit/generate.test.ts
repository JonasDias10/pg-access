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
});
