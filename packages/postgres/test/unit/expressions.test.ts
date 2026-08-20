import { and, authenticated, not, or, owner, publicAccess, role } from "@pg-access/core";
import { describe, expect, it } from "vitest";
import { compileExpression } from "../../src/compiler/expressions.js";
import { postgresDialect } from "../../src/dialect/postgres.js";

describe("compileExpression", () => {
  it("compiles owner() to a column/current-user comparison", () => {
    expect(compileExpression(owner("user_id"), postgresDialect)).toBe(
      '"user_id" = (select auth.uid())',
    );
  });

  it("escapes owner() columns that need quoting", () => {
    expect(compileExpression(owner('weird"col'), postgresDialect)).toBe(
      '"weird""col" = (select auth.uid())',
    );
  });

  it("compiles authenticated() to a not-null check", () => {
    expect(compileExpression(authenticated(), postgresDialect)).toBe(
      "(select auth.uid()) is not null",
    );
  });

  it("compiles publicAccess() to a literal true", () => {
    expect(compileExpression(publicAccess(), postgresDialect)).toBe("true");
  });

  it("compiles role() to an app_metadata claim check with an escaped literal", () => {
    expect(compileExpression(role("admin"), postgresDialect)).toBe(
      "(select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'",
    );
  });

  it("compiles and() by joining with 'and', parenthesized", () => {
    expect(compileExpression(and(authenticated(), owner("user_id")), postgresDialect)).toBe(
      '((select auth.uid()) is not null and "user_id" = (select auth.uid()))',
    );
  });

  it("compiles or() by joining with 'or', parenthesized", () => {
    expect(compileExpression(or(role("admin"), owner("user_id")), postgresDialect)).toBe(
      "((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or \"user_id\" = (select auth.uid()))",
    );
  });

  it("compiles not() using IS NOT TRUE, not the NOT operator", () => {
    // Not just a style choice: SQL's NOT propagates NULL (NOT NULL = NULL,
    // treated as "no match"), so a sub-expression that's merely
    // undetermined; e.g. owner() for an unauthenticated caller, or role()
    // for a user with no role claim; would silently fail a not(...)
    // policy under plain NOT, excluding rows it shouldn't. IS NOT TRUE
    // never itself returns NULL, so "unknown" is correctly treated as "not
    // true" rather than as "matched". See
    // rls.integration.test.ts's "and(owner(), not(role())) on DELETE" for
    // this proven against a real server.
    expect(compileExpression(not(owner("user_id")), postgresDialect)).toBe(
      '("user_id" = (select auth.uid())) is not true',
    );
  });

  it("compiles nested compositions", () => {
    const expression = and(authenticated(), or(owner("user_id"), role("admin")));
    expect(compileExpression(expression, postgresDialect)).toBe(
      "((select auth.uid()) is not null and (\"user_id\" = (select auth.uid()) or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'))",
    );
  });
});
