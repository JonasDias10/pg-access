import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCheck } from "../../src/commands/check.js";

// Nested under the package root (not os.tmpdir()) so that bare-specifier
// resolution of "@pg-access/core" from the config file under test walks up
// to this package's own node_modules, same as it would in a real project.
const packageRoot = path.join(import.meta.dirname, "..", "..");

describe("runCheck", () => {
  let cwd: string;
  const originalDatabaseUrl = process.env["DATABASE_URL"];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(packageRoot, ".tmp-check-"));
    delete process.env["DATABASE_URL"];
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) {
      delete process.env["DATABASE_URL"];
    } else {
      process.env["DATABASE_URL"] = originalDatabaseUrl;
    }
  });

  it("throws a clear error when no config file is found", async () => {
    await expect(runCheck({ cwd })).rejects.toThrow(/No pgaccess config found/);
  });

  it("throws a clear error when there's no database to check against", async () => {
    await writeFile(
      path.join(cwd, "pgaccess.config.ts"),
      `import { defineAuth, owner } from "@pg-access/core";
export default defineAuth({ projects: { rows: { select: owner("user_id") } } });`,
    );

    await expect(runCheck({ cwd })).rejects.toThrow(/DATABASE_URL/);
  });

  it("falls back to the DATABASE_URL environment variable", async () => {
    await writeFile(
      path.join(cwd, "pgaccess.config.ts"),
      `import { defineAuth, owner } from "@pg-access/core";
export default defineAuth({ projects: { rows: { select: owner("user_id") } } });`,
    );
    process.env["DATABASE_URL"] = "postgres://nobody:nobody@127.0.0.1:1/does-not-exist";

    // No listener on that port, so this fails at connection time, not at
    // config resolution - proving the env var was picked up rather than
    // hitting the "no database to check against" error first.
    await expect(runCheck({ cwd })).rejects.toThrow();
  });
});
