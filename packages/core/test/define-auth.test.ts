import { describe, expect, it } from "vitest";
import { and, authenticated, defineAuth, owner, role } from "../src/index.js";

describe("defineAuth", () => {
  it("builds an AST from a single table/policy config", () => {
    const auth = defineAuth({
      projects: {
        rows: {
          select: owner("user_id"),
        },
      },
    });

    expect(auth).toEqual({
      type: "auth",
      tables: [
        {
          type: "table",
          name: "projects",
          rowPolicies: [
            {
              type: "rowPolicy",
              operation: "select",
              expression: { type: "owner", column: "user_id" },
            },
          ],
        },
      ],
    });
  });

  it("preserves declaration order of select/insert/update/delete", () => {
    const auth = defineAuth({
      projects: {
        rows: {
          delete: owner("user_id"),
          select: owner("user_id"),
          update: owner("user_id"),
        },
      },
    });

    expect(auth.tables[0]?.rowPolicies.map((policy) => policy.operation)).toEqual([
      "select",
      "update",
      "delete",
    ]);
  });

  it("supports multiple tables and composite expressions", () => {
    const auth = defineAuth({
      projects: {
        rows: {
          select: owner("user_id"),
          update: and(authenticated(), owner("user_id")),
        },
      },
      admin_settings: {
        rows: {
          select: role("admin"),
        },
      },
    });

    expect(auth.tables).toHaveLength(2);
    expect(auth.tables[1]?.name).toBe("admin_settings");
  });

  it("builds a table with no row policies when rows is omitted", () => {
    const auth = defineAuth({ projects: {} });
    expect(auth.tables[0]).toEqual({ type: "table", name: "projects", rowPolicies: [] });
  });

  it("builds an empty AuthNode from an empty config", () => {
    expect(defineAuth({})).toEqual({ type: "auth", tables: [] });
  });

  it("throws a descriptive error for structurally invalid configs", () => {
    expect(() =>
      defineAuth({
        projects: {
          rows: {
            select: { type: "owner", column: "" },
          },
        },
      }),
    ).toThrow(/Invalid pg-access configuration/);
  });
});
