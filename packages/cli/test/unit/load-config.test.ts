import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "../../src/config/load-config.js";

const fixtures = path.join(import.meta.dirname, "..", "fixtures");

describe("loadAuthConfig", () => {
  it("loads a .ts config's default export as an AuthNode", async () => {
    const auth = await loadAuthConfig(path.join(fixtures, "valid.config.ts"));
    expect(auth.tables).toEqual([expect.objectContaining({ name: "projects" })]);
  });

  it("rejects a default export that isn't an AuthNode", async () => {
    await expect(loadAuthConfig(path.join(fixtures, "invalid-shape.config.ts"))).rejects.toThrow(
      /must default-export the result of defineAuth/,
    );
  });
});
