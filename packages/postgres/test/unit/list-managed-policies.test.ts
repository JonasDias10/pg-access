import { describe, expect, it } from "vitest";
import type { PgQueryable } from "../../src/introspect/list-managed-policies.js";
import { listManagedPolicies } from "../../src/introspect/list-managed-policies.js";

interface FakeRow {
  tablename: string;
  policyname: string;
  qual?: string | null;
  with_check?: string | null;
  /** Comma-joined, matching `array_to_string(roles, ',')` in the query. */
  roles?: string | null;
}

function fakeClient(rows: FakeRow[]): PgQueryable {
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
      {
        tablename: "projects",
        policyname: "projects_select",
        qual: "(user_id = ( SELECT auth.uid() AS uid))",
        with_check: null,
        roles: "authenticated",
      },
      {
        tablename: "projects",
        policyname: "projects_delete",
        qual: "true",
        with_check: null,
        roles: "authenticated,anon",
      },
    ]);

    const result = await listManagedPolicies(client, ["projects"]);

    expect(result).toEqual([
      {
        table: "projects",
        operation: "select",
        name: "projects_select",
        using: "(user_id = ( SELECT auth.uid() AS uid))",
        withCheck: null,
        roles: ["authenticated"],
      },
      {
        table: "projects",
        operation: "delete",
        name: "projects_delete",
        using: "true",
        withCheck: null,
        roles: ["authenticated", "anon"],
      },
    ]);
  });

  it("defaults qual/with_check to null and roles to [] when the row omits them", async () => {
    const client = fakeClient([{ tablename: "projects", policyname: "projects_select" }]);

    const result = await listManagedPolicies(client, ["projects"]);

    expect(result).toEqual([
      {
        table: "projects",
        operation: "select",
        name: "projects_select",
        using: null,
        withCheck: null,
        roles: [],
      },
    ]);
  });

  it("ignores policies that don't match the <table>_<operation> naming convention", async () => {
    const client = fakeClient([
      { tablename: "projects", policyname: "some_hand_written_policy" },
      { tablename: "projects", policyname: "projects_select" },
    ]);

    const result = await listManagedPolicies(client, ["projects"]);

    expect(result.map((policy) => policy.name)).toEqual(["projects_select"]);
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
