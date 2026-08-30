import { authenticated, owner, publicAccess, role } from "@pg-access/core";
import { describe, expect, it } from "vitest";
import {
  compilePolicy,
  policyName,
  renderAlterPolicy,
  renderCreatePolicy,
  renderDropPolicy,
  renderDropPolicyIfExists,
} from "../../src/compiler/policies.js";
import { postgresDialect } from "../../src/dialect/postgres.js";

describe("policyName", () => {
  it("is deterministic: <table>_<operation>", () => {
    expect(policyName("projects", "select")).toBe("projects_select");
    expect(policyName("projects", "insert")).toBe("projects_insert");
    expect(policyName("projects", "update")).toBe("projects_update");
    expect(policyName("projects", "delete")).toBe("projects_delete");
  });
});

describe("compilePolicy: USING vs WITH CHECK placement", () => {
  it("SELECT uses USING only", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "select", expression: owner("user_id") },
      postgresDialect,
    );
    expect(compiled.using).not.toBeNull();
    expect(compiled.withCheck).toBeNull();
  });

  it("DELETE uses USING only", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "delete", expression: owner("user_id") },
      postgresDialect,
    );
    expect(compiled.using).not.toBeNull();
    expect(compiled.withCheck).toBeNull();
  });

  it("INSERT uses WITH CHECK only", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "insert", expression: owner("user_id") },
      postgresDialect,
    );
    expect(compiled.using).toBeNull();
    expect(compiled.withCheck).not.toBeNull();
  });

  it("UPDATE uses both USING and WITH CHECK", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "update", expression: owner("user_id") },
      postgresDialect,
    );
    expect(compiled.using).not.toBeNull();
    expect(compiled.withCheck).not.toBeNull();
    expect(compiled.using).toBe(compiled.withCheck);
  });
});

describe("compilePolicy: TO role derivation", () => {
  it("scopes owner()/authenticated()/role() policies to the authenticated role", () => {
    for (const expression of [owner("user_id"), authenticated(), role("admin")]) {
      const compiled = compilePolicy(
        "projects",
        { type: "rowPolicy", operation: "select", expression },
        postgresDialect,
      );
      expect(compiled.role).toBe("authenticated");
    }
  });

  it("scopes publicAccess() policies to the public role", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "select", expression: publicAccess() },
      postgresDialect,
    );
    expect(compiled.role).toBe("public");
  });
});

describe("renderDropPolicyIfExists", () => {
  it("renders a DROP POLICY IF EXISTS for the policy's own name and table", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "select", expression: owner("user_id") },
      postgresDialect,
    );

    expect(renderDropPolicyIfExists(compiled)).toBe(
      'drop policy if exists "projects_select" on "projects";',
    );
  });

  it("escapes table and policy names that need quoting", () => {
    const compiled = compilePolicy(
      'weird"table',
      { type: "rowPolicy", operation: "delete", expression: owner("user_id") },
      postgresDialect,
    );

    expect(renderDropPolicyIfExists(compiled)).toBe(
      'drop policy if exists "weird""table_delete" on "weird""table";',
    );
  });
});

describe("renderDropPolicy", () => {
  it("renders a DROP POLICY IF EXISTS from just a table/name pair", () => {
    expect(renderDropPolicy({ table: "projects", name: "projects_delete" })).toBe(
      'drop policy if exists "projects_delete" on "projects";',
    );
  });

  it("escapes table and policy names that need quoting", () => {
    expect(renderDropPolicy({ table: 'weird"table', name: 'weird"policy' })).toBe(
      'drop policy if exists "weird""policy" on "weird""table";',
    );
  });
});

describe("renderCreatePolicy", () => {
  it("renders a full CREATE POLICY statement for a SELECT policy", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "select", expression: owner("user_id") },
      postgresDialect,
    );

    expect(renderCreatePolicy(compiled)).toBe(
      [
        'create policy "projects_select"',
        'on "projects"',
        "for select",
        'to "authenticated"',
        'using (\n  "user_id" = (select auth.uid())\n)',
      ].join("\n") + ";",
    );
  });

  it("renders both USING and WITH CHECK for an UPDATE policy", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "update", expression: owner("user_id") },
      postgresDialect,
    );
    const sql = renderCreatePolicy(compiled);

    expect(sql).toContain('using (\n  "user_id" = (select auth.uid())\n)');
    expect(sql).toContain('with check (\n  "user_id" = (select auth.uid())\n)');
  });

  it("renders PUBLIC unquoted for publicAccess() policies", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "select", expression: publicAccess() },
      postgresDialect,
    );
    expect(renderCreatePolicy(compiled)).toContain("to public");
  });
});

describe("renderAlterPolicy", () => {
  it("changes TO and USING in place, without dropping the policy", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "select", expression: owner("user_id") },
      postgresDialect,
    );

    expect(renderAlterPolicy(compiled)).toBe(
      [
        'alter policy "projects_select"',
        'on "projects"',
        'to "authenticated"',
        'using (\n  "user_id" = (select auth.uid())\n)',
      ].join("\n") + ";",
    );
  });

  it("emits WITH CHECK but no USING for an INSERT policy", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "insert", expression: owner("user_id") },
      postgresDialect,
    );
    const sql = renderAlterPolicy(compiled);

    expect(sql).toContain("with check (");
    expect(sql).not.toContain("using (");
  });

  it("never emits `for <operation>`, which ALTER POLICY cannot change", () => {
    const compiled = compilePolicy(
      "projects",
      { type: "rowPolicy", operation: "update", expression: owner("user_id") },
      postgresDialect,
    );
    expect(renderAlterPolicy(compiled)).not.toContain("for update");
  });
});
