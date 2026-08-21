import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/commands/init.js";

describe("runInit", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pg-access-init-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("scaffolds pgaccess.config.ts in the current directory", async () => {
    const result = await runInit({ cwd: dir });

    expect(result.filePath).toBe(path.join(dir, "pgaccess.config.ts"));
    const written = await readFile(result.filePath, "utf8");
    expect(written).toContain("defineAuth");
    expect(written).toContain("@pg-access/core");
  });

  it("refuses to overwrite an existing config", async () => {
    await writeFile(path.join(dir, "pgaccess.config.ts"), "export default {};");

    await expect(runInit({ cwd: dir })).rejects.toThrow(/already exists/);
  });

  it("scaffolds at a custom --config path", async () => {
    const result = await runInit({ cwd: dir, config: "custom.config.ts" });

    expect(result.filePath).toBe(path.join(dir, "custom.config.ts"));
    await expect(readFile(result.filePath, "utf8")).resolves.toContain("defineAuth");
  });
});
