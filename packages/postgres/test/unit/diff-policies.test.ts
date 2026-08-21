import { defineAuth, owner } from "@pg-access/core";
import { describe, expect, it } from "vitest";
import { diffPolicies } from "../../src/diff/diff-policies.js";
import type { ManagedPolicy } from "../../src/introspect/list-managed-policies.js";

describe("diffPolicies", () => {
  it("reports no drift when the database already matches the config", () => {
    const auth = defineAuth({ projects: { rows: { select: owner("user_id") } } });
    const existing: ManagedPolicy[] = [
      { table: "projects", operation: "select", name: "projects_select" },
    ];

    expect(diffPolicies(auth, existing)).toEqual({ missing: [], orphaned: [] });
  });

  it("flags a policy declared in the config but not yet applied as missing", () => {
    const auth = defineAuth({ projects: { rows: { select: owner("user_id") } } });

    expect(diffPolicies(auth, [])).toEqual({
      missing: [{ table: "projects", name: "projects_select" }],
      orphaned: [],
    });
  });

  it("flags a managed policy applied to the database but removed from the config as orphaned", () => {
    const auth = defineAuth({ projects: { rows: { select: owner("user_id") } } });
    const existing: ManagedPolicy[] = [
      { table: "projects", operation: "select", name: "projects_select" },
      { table: "projects", operation: "delete", name: "projects_delete" },
    ];

    expect(diffPolicies(auth, existing)).toEqual({
      missing: [],
      orphaned: [{ table: "projects", name: "projects_delete" }],
    });
  });

  it("doesn't cross-contaminate tables with the same operation", () => {
    const auth = defineAuth({
      projects: { rows: { select: owner("user_id") } },
      orders: { rows: { select: owner("user_id") } },
    });
    const existing: ManagedPolicy[] = [
      { table: "projects", operation: "select", name: "projects_select" },
    ];

    expect(diffPolicies(auth, existing)).toEqual({
      missing: [{ table: "orders", name: "orders_select" }],
      orphaned: [],
    });
  });
});
