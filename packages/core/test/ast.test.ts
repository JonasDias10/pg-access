import { describe, expect, it } from "vitest";
import { buildAuthNode } from "../src/ast/builders.js";
import { owner } from "../src/index.js";

describe("buildAuthNode", () => {
  it("only includes operations that were explicitly configured", () => {
    const auth = buildAuthNode({
      projects: { rows: { select: owner("user_id") } },
    });

    const operations = auth.tables[0]?.rowPolicies.map((policy) => policy.operation);
    expect(operations).toEqual(["select"]);
  });

  it("produces one table node per config key, in insertion order", () => {
    const auth = buildAuthNode({
      projects: {},
      teams: {},
    });

    expect(auth.tables.map((table) => table.name)).toEqual(["projects", "teams"]);
  });
});
