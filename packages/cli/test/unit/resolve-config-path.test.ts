import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfigPath } from "../../src/config/resolve-config-path.js";

describe("resolveConfigPath", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pg-access-resolve-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns undefined when no config file exists", () => {
    expect(resolveConfigPath(dir)).toBeUndefined();
  });

  it("finds pgaccess.config.ts", async () => {
    await writeFile(path.join(dir, "pgaccess.config.ts"), "export default {};");
    expect(resolveConfigPath(dir)).toBe(path.join(dir, "pgaccess.config.ts"));
  });

  it("prefers pgaccess.config.ts over pgaccess.config.js when both exist", async () => {
    await writeFile(path.join(dir, "pgaccess.config.ts"), "export default {};");
    await writeFile(path.join(dir, "pgaccess.config.js"), "export default {};");
    expect(resolveConfigPath(dir)).toBe(path.join(dir, "pgaccess.config.ts"));
  });

  it("falls back to pgaccess.config.js when no .ts config exists", async () => {
    await writeFile(path.join(dir, "pgaccess.config.js"), "export default {};");
    expect(resolveConfigPath(dir)).toBe(path.join(dir, "pgaccess.config.js"));
  });

  it("resolves an explicit path relative to cwd", async () => {
    await writeFile(path.join(dir, "custom.config.ts"), "export default {};");
    expect(resolveConfigPath(dir, "custom.config.ts")).toBe(path.join(dir, "custom.config.ts"));
  });

  it("returns undefined for an explicit path that doesn't exist", () => {
    expect(resolveConfigPath(dir, "missing.config.ts")).toBeUndefined();
  });
});
