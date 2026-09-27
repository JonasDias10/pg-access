import { defineAuth, owner, publicAccess } from "@pg-access/core";
import { describe, expect, it } from "vitest";
import { postgresDialect } from "../../src/dialect/postgres.js";
import {
  createSnapshot,
  parseSnapshot,
  planSnapshotChanges,
  serializeSnapshot,
} from "../../src/snapshot/snapshot.js";

describe("createSnapshot / serializeSnapshot", () => {
  it("records each compiled policy with its roles, USING and WITH CHECK", () => {
    const snapshot = createSnapshot(defineAuth({ notes: { rows: { insert: owner("user_id") } } }));

    expect(snapshot).toEqual({
      version: 1,
      policies: [
        {
          table: "notes",
          operation: "insert",
          name: "notes_insert",
          roles: ["authenticated"],
          using: null,
          withCheck: '"user_id" = (select auth.uid())',
        },
      ],
    });
  });

  it("is byte-identical whatever order tables and operations were declared in", () => {
    const a = defineAuth({
      notes: { rows: { delete: owner("user_id"), select: publicAccess() } },
      boards: { rows: { select: owner("user_id") } },
    });
    const b = defineAuth({
      boards: { rows: { select: owner("user_id") } },
      notes: { rows: { select: publicAccess(), delete: owner("user_id") } },
    });

    const serialized = serializeSnapshot(createSnapshot(a));

    expect(serializeSnapshot(createSnapshot(b))).toBe(serialized);
    expect(parseSnapshot(serialized).policies.map((policy) => policy.name)).toEqual([
      "boards_select",
      "notes_select",
      "notes_delete",
    ]);
    expect(serialized.endsWith("}\n")).toBe(true);
  });

  it("writes roles on one line, escaped, the way Prettier would", () => {
    const serialized = serializeSnapshot({
      version: 1,
      policies: [
        {
          table: "notes",
          operation: "select",
          name: "notes_select",
          roles: ['b,]"role', "a"],
          using: "true",
          withCheck: null,
        },
      ],
    });

    expect(serialized).toContain('      "roles": ["a", "b,]\\"role"],\n');
    expect(parseSnapshot(serialized).policies[0]?.roles).toEqual(["a", 'b,]"role']);
  });

  it("round-trips through parseSnapshot", () => {
    const snapshot = createSnapshot(defineAuth({ notes: { rows: { update: owner("user_id") } } }));

    expect(parseSnapshot(serializeSnapshot(snapshot))).toEqual(snapshot);
  });
});

describe("parseSnapshot", () => {
  it("rejects invalid JSON", () => {
    expect(() => parseSnapshot("{")).toThrow(/not valid JSON/);
  });

  it("rejects an unknown version", () => {
    expect(() => parseSnapshot('{ "version": 2, "policies": [] }')).toThrow(
      /Unsupported pg-access snapshot version 2/,
    );
  });

  it("rejects a malformed policy", () => {
    expect(() =>
      parseSnapshot(
        JSON.stringify({ version: 1, policies: [{ table: "notes", operation: "truncate" }] }),
      ),
    ).toThrow(/malformed `policies`/);
  });
});

describe("planSnapshotChanges", () => {
  const v1 = defineAuth({
    notes: { rows: { select: owner("user_id"), delete: owner("user_id") } },
  });
  const snapshot = createSnapshot(v1);

  it("emits nothing when the config still matches the snapshot", () => {
    const plan = planSnapshotChanges(snapshot, v1);

    expect(plan.changes.map((change) => change.kind)).toEqual(["noop", "noop"]);
    expect(plan.sql).toBe("");
    expect(plan.down).toEqual({ statements: [], sql: "" });
  });

  it("decides create / alter / drop the same way the live diff does", () => {
    const v2 = defineAuth({
      notes: { rows: { select: owner("author_id"), insert: owner("user_id") } },
    });

    const plan = planSnapshotChanges(snapshot, v2);

    expect(plan.changes).toEqual([
      { table: "notes", operation: "select", name: "notes_select", kind: "alter" },
      { table: "notes", operation: "insert", name: "notes_insert", kind: "create" },
      { table: "notes", operation: "delete", name: "notes_delete", kind: "drop" },
    ]);
    expect(plan.statements.map((statement) => statement.split("\n")[0])).toEqual([
      'alter table "notes" enable row level security;',
      'alter policy "notes_select"',
      'drop policy if exists "notes_insert" on "notes";',
      'create policy "notes_insert"',
      'drop policy if exists "notes_delete" on "notes";',
    ]);
  });

  it("treats a role change as drift", () => {
    const v2 = defineAuth({
      notes: { rows: { select: publicAccess(), delete: owner("user_id") } },
    });

    const plan = planSnapshotChanges(snapshot, v2);

    expect(plan.changes[0]?.kind).toBe("alter");
    expect(plan.sql).toContain("to public");
  });

  it("rolls back to the snapshot's definitions and never turns RLS off", () => {
    const v2 = defineAuth({
      notes: { rows: { select: owner("author_id"), insert: owner("user_id") } },
    });

    const { down } = planSnapshotChanges(snapshot, v2);

    expect(down.statements.map((statement) => statement.split("\n")[0])).toEqual([
      'create policy "notes_delete"',
      'alter policy "notes_select"',
      'drop policy if exists "notes_insert" on "notes";',
    ]);
    expect(down.sql).toContain('"user_id" = (select auth.uid())');
    expect(down.sql).not.toContain("disable row level security");
  });

  it("drops every policy of a table emptied to rows: {}", () => {
    const plan = planSnapshotChanges(snapshot, defineAuth({ notes: { rows: {} } }));

    expect(plan.changes.map((change) => change.kind)).toEqual(["drop", "drop"]);
    expect(plan.sql).not.toContain("enable row level security");
  });

  it("leaves a table removed from the config entirely alone, like the live diff", () => {
    const plan = planSnapshotChanges(snapshot, defineAuth({ boards: { rows: {} } }));

    expect(plan.changes).toEqual([]);
    expect(plan.sql).toBe("");
  });

  it("compiles the config with the given dialect", () => {
    const dialect = { ...postgresDialect, currentUserIdExpression: "current_setting('my.uid')" };

    const plan = planSnapshotChanges(snapshot, v1, { dialect });

    expect(plan.changes.map((change) => change.kind)).toEqual(["alter", "alter"]);
    expect(plan.sql).toContain("current_setting('my.uid')");
  });
});
