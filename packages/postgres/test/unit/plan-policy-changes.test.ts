import { defineAuth, owner, publicAccess } from "@pg-access/core";
import { describe, expect, it } from "vitest";
import { planPolicyChanges } from "../../src/diff/plan-policy-changes.js";
import { postgresDialect } from "../../src/dialect/postgres.js";
import type { PgQueryable } from "../../src/introspect/list-managed-policies.js";

interface PolicyState {
  qual: string | null;
  with_check: string | null;
  roles: string[];
}

/**
 * Stands in for a real PostgreSQL session. `applied` is what `pg_policies`
 * already holds; `normalized` is what the rolled-back round-trip reads back
 * for the config's compiled policies (i.e. Postgres's canonical form of
 * them). A policy is "unchanged" when its `applied` and `normalized` entries
 * are equal.
 */
function fakeSession(options: {
  applied?: Record<string, PolicyState>;
  normalized?: Record<string, PolicyState>;
  liveTables?: string[] | null;
}): { session: PgQueryable; statements: string[]; queries: string[] } {
  const applied = options.applied ?? {};
  const normalized = options.normalized ?? {};
  const statements: string[] = [];
  /** Full text of every `query()` call, for asserting on round-trip count/shape. */
  const queries: string[] = [];

  // `roles` mirrors the query's `array_to_string(roles, ',')`: a comma string, not an array.
  const rowsFor = (source: Record<string, PolicyState>, names?: string[]) =>
    Object.entries(source)
      .filter(([name]) => names === undefined || names.includes(name))
      .map(([name, state]) => ({
        tablename: name.slice(0, name.lastIndexOf("_")),
        policyname: name,
        qual: state.qual,
        with_check: state.with_check,
        roles: state.roles.join(","),
      }));

  const session: PgQueryable = {
    query: async (text, values) => {
      statements.push(text.trim().split("\n")[0] ?? text);
      queries.push(text);

      if (text.includes("from pg_tables")) {
        const requested = (values?.[0] as string[] | undefined) ?? [];
        const live =
          options.liveTables === undefined
            ? requested
            : (options.liveTables ?? []).filter((table) => requested.includes(table));
        return { rows: live.map((tablename) => ({ tablename })) };
      }

      if (text.includes("from pg_policies")) {
        const names = values?.[1] as string[] | undefined;
        return { rows: names === undefined ? rowsFor(applied) : rowsFor(normalized, names) };
      }

      return { rows: [] };
    },
  };

  return { session, statements, queries };
}

const ownerState: PolicyState = {
  qual: "(user_id = ( SELECT auth.uid() AS uid))",
  with_check: null,
  roles: ["authenticated"],
};

describe("planPolicyChanges", () => {
  const auth = defineAuth({ projects: { rows: { select: owner("user_id") } } });

  it("emits nothing when every declared policy already matches the database", async () => {
    const { session } = fakeSession({
      applied: { projects_select: ownerState },
      normalized: { projects_select: ownerState },
    });

    const plan = await planPolicyChanges(session, auth);

    expect(plan.changes).toEqual([
      { table: "projects", operation: "select", name: "projects_select", kind: "noop" },
    ]);
    expect(plan.statements).toEqual([]);
    expect(plan.sql).toBe("");
  });

  it("ALTERs a policy whose applied definition drifted from the config", async () => {
    const { session } = fakeSession({
      applied: {
        projects_select: {
          qual: "(user_id = other_column)",
          with_check: null,
          roles: ["authenticated"],
        },
      },
      normalized: { projects_select: ownerState },
    });

    const plan = await planPolicyChanges(session, auth);

    expect(plan.changes).toEqual([
      { table: "projects", operation: "select", name: "projects_select", kind: "alter" },
    ]);
    expect(plan.sql).toContain('alter policy "projects_select"');
    expect(plan.sql).not.toContain("create policy");
    expect(plan.sql).toContain("enable row level security");
  });

  it("treats a role-only difference as drift", async () => {
    const { session } = fakeSession({
      applied: { projects_select: { ...ownerState, roles: ["public"] } },
      normalized: { projects_select: ownerState },
    });

    const plan = await planPolicyChanges(session, auth);
    expect(plan.changes[0]?.kind).toBe("alter");
  });

  it("CREATEs a policy the database doesn't have yet", async () => {
    const { session } = fakeSession({ applied: {}, normalized: { projects_select: ownerState } });

    const plan = await planPolicyChanges(session, auth);

    expect(plan.changes).toEqual([
      { table: "projects", operation: "select", name: "projects_select", kind: "create" },
    ]);
    expect(plan.sql).toContain('create policy "projects_select"');
  });

  it("DROPs a managed policy that's applied but no longer declared", async () => {
    const { session } = fakeSession({
      applied: {
        projects_select: ownerState,
        projects_delete: { qual: "true", with_check: null, roles: ["authenticated"] },
      },
      normalized: { projects_select: ownerState },
    });

    const plan = await planPolicyChanges(session, auth);

    expect(plan.changes).toContainEqual({
      table: "projects",
      operation: "delete",
      name: "projects_delete",
      kind: "drop",
    });
    expect(plan.sql).toContain('drop policy if exists "projects_delete" on "projects";');
  });

  it("DROPs managed policies on a table still in the config but whose rows became empty", async () => {
    // `posts: {}` keeps the table key but declares no policies. The managed
    // ones already on it must still be found and dropped, not left orphaned.
    const emptied = defineAuth({ projects: { rows: {} } });
    const { session } = fakeSession({
      applied: {
        projects_select: ownerState,
        projects_delete: { qual: "true", with_check: null, roles: ["authenticated"] },
      },
      normalized: {},
    });

    const plan = await planPolicyChanges(session, emptied);

    expect(plan.changes).toEqual([
      { table: "projects", operation: "select", name: "projects_select", kind: "drop" },
      { table: "projects", operation: "delete", name: "projects_delete", kind: "drop" },
    ]);
    expect(plan.sql).toContain('drop policy if exists "projects_select" on "projects";');
    expect(plan.sql).toContain('drop policy if exists "projects_delete" on "projects";');
    expect(plan.sql).not.toContain("enable row level security");
  });

  it("on one table: skips the unchanged policy, ALTERs the drifted one, one ENABLE RLS", async () => {
    const both = defineAuth({
      projects: { rows: { select: owner("user_id"), insert: owner("user_id") } },
    });
    const { session } = fakeSession({
      applied: {
        projects_select: ownerState,
        projects_insert: { qual: null, with_check: "(user_id = stale)", roles: ["authenticated"] },
      },
      normalized: {
        projects_select: ownerState,
        projects_insert: { qual: null, with_check: ownerState.qual, roles: ["authenticated"] },
      },
    });

    const plan = await planPolicyChanges(session, both);

    expect(plan.changes).toEqual([
      { table: "projects", operation: "select", name: "projects_select", kind: "noop" },
      { table: "projects", operation: "insert", name: "projects_insert", kind: "alter" },
    ]);
    expect(plan.statements.filter((s) => s.includes("enable row level security"))).toHaveLength(1);
    expect(plan.sql).toContain('alter policy "projects_insert"');
    expect(plan.sql).not.toContain("projects_select");
  });

  it("CREATEs (not ALTERs) when the target table doesn't exist yet, skipping normalization", async () => {
    const { session, statements } = fakeSession({
      applied: {},
      normalized: {},
      liveTables: [],
    });

    const plan = await planPolicyChanges(session, auth);

    expect(plan.changes[0]?.kind).toBe("create");
    expect(statements).not.toContain("begin");
  });

  it("always rolls the normalization transaction back", async () => {
    const { session, statements } = fakeSession({
      applied: { projects_select: ownerState },
      normalized: { projects_select: ownerState },
    });

    await planPolicyChanges(session, auth);

    expect(statements).toContain("begin");
    expect(statements).toContain("rollback");
    expect(statements).not.toContain("commit");
  });

  it("sends the whole normalization drop+recreate as one query, not two per policy", async () => {
    const multi = defineAuth({
      projects: {
        rows: { select: owner("user_id"), insert: owner("user_id"), update: owner("user_id") },
      },
    });
    const applied = {
      projects_select: ownerState,
      projects_insert: ownerState,
      projects_update: ownerState,
    };
    const { session, queries } = fakeSession({ applied, normalized: applied });

    await planPolicyChanges(session, multi);

    const setup = queries.find((q) => q.includes("drop policy if exists"));
    expect(setup).toBeDefined();
    expect(setup?.match(/create policy/g)).toHaveLength(3);
    // begin + one batched setup + one readback + rollback, regardless of policy count.
    expect(queries.filter((q) => q.startsWith("drop policy if exists"))).toHaveLength(1);
  });

  it("opens no transaction when there is nothing to compare (first migration / adds only)", async () => {
    const { session, queries } = fakeSession({
      applied: {},
      normalized: { projects_select: ownerState },
    });

    await planPolicyChanges(session, auth);

    expect(queries).not.toContain("begin");
  });

  it("compiles the config's policies with the given dialect", async () => {
    const { session } = fakeSession({ applied: {}, normalized: {} });
    const dialect = {
      ...postgresDialect,
      currentUserIdExpression: "current_setting('my.uid')",
    };

    const plan = await planPolicyChanges(session, auth, { dialect });

    expect(plan.sql).toContain("current_setting('my.uid')");
    expect(plan.sql).not.toContain("auth.uid()");
  });

  it("orders statements select/insert/update/delete and precedes them with ENABLE RLS", async () => {
    const multi = defineAuth({
      projects: {
        rows: {
          update: owner("user_id"),
          select: owner("user_id"),
          insert: publicAccess(),
        },
      },
    });
    const { session } = fakeSession({ applied: {}, normalized: {} });

    const plan = await planPolicyChanges(session, multi);
    const firstLines = plan.statements
      .filter((s) => s.startsWith("create policy"))
      .map((s) => s.split("\n")[0]);

    expect(plan.statements[0]).toBe('alter table "projects" enable row level security;');
    expect(firstLines).toEqual([
      'create policy "projects_select"',
      'create policy "projects_insert"',
      'create policy "projects_update"',
    ]);
  });
});
