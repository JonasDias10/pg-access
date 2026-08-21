import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";

describe("main", () => {
  it("prints usage and exits 1 when no command is given", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitCode = await main([]);
    expect(exitCode).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    log.mockRestore();
  });

  it("prints usage and exits 0 for --help", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitCode = await main(["--help"]);
    expect(exitCode).toBe(0);
    log.mockRestore();
  });

  it("prints the version for --version", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitCode = await main(["--version"]);
    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
    log.mockRestore();
  });

  it("exits 1 with an error for an unknown command", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitCode = await main(["frobnicate"]);
    expect(exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Unknown command: frobnicate"));
    error.mockRestore();
    log.mockRestore();
  });

  it("exits 1 with a clear error when generate can't find a config", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCode = await main(["generate", "--config", "does-not-exist.ts"]);
    expect(exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Config file not found"));
    error.mockRestore();
  });

  it("scaffolds a config file for init", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pg-access-cli-init-"));
    const originalCwd = process.cwd();
    process.chdir(dir);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const exitCode = await main(["init"]);
      expect(exitCode).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Wrote pgaccess.config.ts"));
    } finally {
      log.mockRestore();
      process.chdir(originalCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
