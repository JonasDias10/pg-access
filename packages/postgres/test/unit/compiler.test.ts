import { defineAuth, owner } from "@pg-access/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compiler/compiler.js";
import type { ManagedPolicy } from "../../src/introspect/list-managed-policies.js";

describe("compile", () => {
  it("compiles the canonical owner() example to a real CREATE POLICY statement", () => {
    const auth = defineAuth({
      projects: {
        rows: {
          select: owner("user_id"),
        },
      },
    });

    const result = compile(auth);

    expect(result.statements).toEqual([
      'alter table "projects" enable row level security;',
      'drop policy if exists "projects_select" on "projects";',
      [
        'create policy "projects_select"',
        'on "projects"',
        "for select",
        'to "authenticated"',
        'using (\n  "user_id" = (select auth.uid())\n)',
      ].join("\n") + ";",
    ]);
    expect(result.sql).toContain("enable row level security");
    expect(result.sql).toContain("auth.uid()");
  });

  it("emits one policy per configured operation, in select/insert/update/delete order", () => {
    const auth = defineAuth({
      projects: {
        rows: {
          delete: owner("user_id"),
          select: owner("user_id"),
          insert: owner("user_id"),
          update: owner("user_id"),
        },
      },
    });

    const policyNames = compile(auth).statements.filter((s) => s.startsWith("create policy"));
    expect(policyNames).toHaveLength(4);
    expect(policyNames[0]).toContain("projects_select");
    expect(policyNames[1]).toContain("projects_insert");
    expect(policyNames[2]).toContain("projects_update");
    expect(policyNames[3]).toContain("projects_delete");
  });

  it("emits nothing for a table with no row policies, rather than a blanket deny", () => {
    const auth = defineAuth({ projects: {} });
    const result = compile(auth);
    expect(result.statements).toEqual([]);
    expect(result.sql).toBe("");
  });

  it("compiles multiple tables independently", () => {
    const auth = defineAuth({
      projects: { rows: { select: owner("user_id") } },
      teams: { rows: { select: owner("owner_id") } },
    });

    const result = compile(auth);
    expect(result.statements.filter((s) => s.startsWith("alter table"))).toHaveLength(2);
    expect(result.sql).toContain('"projects"');
    expect(result.sql).toContain('"teams"');
  });

  it("precedes each CREATE POLICY with a DROP POLICY IF EXISTS for that same policy", () => {
    // Regenerating a migration after only changing a policy's expression
    // must stay applicable against a database that already has the
    // previous version, since CREATE POLICY errors on a name collision
    // instead of replacing it.
    const auth = defineAuth({
      projects: {
        rows: {
          select: owner("user_id"),
          insert: owner("user_id"),
        },
      },
    });

    const result = compile(auth);

    expect(result.statements).toEqual([
      'alter table "projects" enable row level security;',
      'drop policy if exists "projects_select" on "projects";',
      expect.stringContaining('create policy "projects_select"'),
      'drop policy if exists "projects_insert" on "projects";',
      expect.stringContaining('create policy "projects_insert"'),
    ]);
  });

  it("without existingPolicies, leaves a policy removed from the config untouched", () => {
    // The documented gap this option exists to close: without it, compile()
    // has no way to know a policy used to exist at all.
    const auth = defineAuth({ projects: { rows: { select: owner("user_id") } } });
    const result = compile(auth);
    expect(result.sql).not.toContain("projects_delete");
  });

  it("with existingPolicies, drops a managed policy no longer declared in the config", () => {
    const auth = defineAuth({ projects: { rows: { select: owner("user_id") } } });
    const existingPolicies: ManagedPolicy[] = [
      { table: "projects", operation: "select", name: "projects_select" },
      { table: "projects", operation: "delete", name: "projects_delete" },
    ];

    const result = compile(auth, { existingPolicies });

    expect(result.statements).toContain('drop policy if exists "projects_delete" on "projects";');
    // projects_select is still declared, so it goes through the normal
    // drop-then-recreate path, not the orphan path - it shouldn't also be
    // dropped a second time as if it were orphaned.
    expect(result.statements.filter((s) => s.includes("projects_select"))).toHaveLength(2);
  });

  it("with existingPolicies, drops every managed policy for a table whose rows became empty", () => {
    const auth = defineAuth({ projects: {} });
    const existingPolicies: ManagedPolicy[] = [
      { table: "projects", operation: "select", name: "projects_select" },
    ];

    const result = compile(auth, { existingPolicies });

    expect(result.statements).toEqual(['drop policy if exists "projects_select" on "projects";']);
  });

  it("compile() is public and defensively rejects a hand-built, unvalidated AuthNode", () => {
    // compile() is exported directly, nothing forces callers through
    // defineAuth()'s validation first. It should still fail loudly instead
    // of emitting broken SQL for a structurally invalid AST.
    const invalidAuth = {
      type: "auth" as const,
      tables: [
        {
          type: "table" as const,
          name: "",
          rowPolicies: [
            { type: "rowPolicy" as const, operation: "select" as const, expression: owner("id") },
          ],
        },
      ],
    };

    expect(() => compile(invalidAuth)).toThrow(/empty SQL identifier/);
  });
});
