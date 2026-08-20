import { and, authenticated, defineAuth, not, or, owner, role } from "@pg-access/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compiler/compiler.js";
import { compileExpression } from "../../src/compiler/expressions.js";
import type { Dialect } from "../../src/dialect/postgres.js";
import { postgresDialect } from "../../src/dialect/postgres.js";

/**
 * A non-Supabase dialect: current user comes from a plain session GUC
 * instead of `auth.uid()`, and roles come from `current_setting`'s own
 * naming rather than `app_metadata`. Exactly the kind of dialect the
 * README claims a non-Supabase project could supply, this test is what
 * actually proves `compile()` doesn't have Supabase's SQL hardcoded
 * anywhere outside `postgresDialect` itself.
 */
const plainPostgresDialect: Dialect = {
  // nullif(..., '') guards against a custom GUC read back as '' instead of
  // truly unset; a real risk with connection pooling, see
  // custom-dialect.integration.test.ts for it happening against a real
  // server.
  currentUserIdExpression: "(select nullif(current_setting('app.user_id', true), '')::uuid)",
  authenticatedRole: "app_user",
  publicRole: "public",
  roleExpression: (roleLiteral) => `(select current_setting('app.role', true)) = ${roleLiteral}`,
};

describe("custom Dialect", () => {
  it("compileExpression uses the given dialect's currentUserIdExpression for owner()", () => {
    expect(compileExpression(owner("user_id"), plainPostgresDialect)).toBe(
      "\"user_id\" = (select nullif(current_setting('app.user_id', true), '')::uuid)",
    );
  });

  it("compileExpression uses the given dialect's currentUserIdExpression for authenticated()", () => {
    expect(compileExpression(authenticated(), plainPostgresDialect)).toBe(
      "(select nullif(current_setting('app.user_id', true), '')::uuid) is not null",
    );
  });

  it("compileExpression uses the given dialect's roleExpression for role()", () => {
    expect(compileExpression(role("admin"), plainPostgresDialect)).toBe(
      "(select current_setting('app.role', true)) = 'admin'",
    );
  });

  it("composes correctly under a custom dialect, same as the default one", () => {
    const expression = and(authenticated(), or(owner("id"), not(role("banned"))));
    expect(compileExpression(expression, plainPostgresDialect)).toBe(
      "((select nullif(current_setting('app.user_id', true), '')::uuid) is not null and " +
        "(\"id\" = (select nullif(current_setting('app.user_id', true), '')::uuid) or " +
        "((select current_setting('app.role', true)) = 'banned') is not true))",
    );
  });

  it("compile() scopes the TO clause to the dialect's own authenticatedRole/publicRole", () => {
    const auth = defineAuth({ projects: { rows: { select: owner("user_id") } } });
    const result = compile(auth, { dialect: plainPostgresDialect });

    expect(result.sql).toContain('to "app_user"');
    expect(result.sql).not.toContain("authenticated");
    expect(result.sql).not.toContain("auth.uid()");
    expect(result.sql).not.toContain("auth.jwt()");
  });

  it("compile() without an explicit dialect still defaults to postgresDialect", () => {
    const auth = defineAuth({ projects: { rows: { select: owner("user_id") } } });
    const result = compile(auth);

    expect(result.sql).toContain("auth.uid()");
    expect(result.sql).toContain(postgresDialect.authenticatedRole);
  });
});
