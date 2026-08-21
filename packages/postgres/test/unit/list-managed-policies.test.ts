import { describe, expect, it } from "vitest";
import type { PgQueryable } from "../../src/introspect/list-managed-policies.js";
import { listManagedPolicies } from "../../src/introspect/list-managed-policies.js";

function fakeClient(rows: { tablename: string; policyname: string }[]): PgQueryable {
  return {
    query: async () => ({ rows }),
  };
}

describe("listManagedPolicies", () => {
  it("returns nothing without querying when no tables are given", async () => {
    let queried = false;
    const client: PgQueryable = {
      query: async () => {
        queried = true;
        return { rows: [] };
      },
    };

    expect(await listManagedPolicies(client, [])).toEqual([]);
    expect(queried).toBe(false);
  });

  it("recognizes pg-access-managed policy names and parses their operation", async () => {
    const client = fakeClient([
      { tablename: "projects", policyname: "projects_select" },
      { tablename: "projects", policyname: "projects_delete" },
    ]);

    const result = await listManagedPolicies(client, ["projects"]);

    expect(result).toEqual([
      { table: "projects", operation: "select", name: "projects_select" },
      { table: "projects", operation: "delete", name: "projects_delete" },
    ]);
  });

  it("ignores policies that don't match the <table>_<operation> naming convention", async () => {
    const client = fakeClient([
      { tablename: "projects", policyname: "some_hand_written_policy" },
      { tablename: "projects", policyname: "projects_select" },
    ]);

    const result = await listManagedPolicies(client, ["projects"]);

    expect(result).toEqual([{ table: "projects", operation: "select", name: "projects_select" }]);
  });

  it("passes the requested tables through to the query", async () => {
    let receivedValues: readonly unknown[] | undefined;
    const client: PgQueryable = {
      query: async (_text, values) => {
        receivedValues = values;
        return { rows: [] };
      },
    };

    await listManagedPolicies(client, ["projects", "orders"]);

    expect(receivedValues).toEqual([["projects", "orders"]]);
  });
});
