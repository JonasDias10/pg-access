import { describe, expect, it } from "vitest";
import { and, authenticated, not, or, owner, publicAccess, role } from "../src/index.js";

describe("owner", () => {
  it("creates an owner expression node", () => {
    expect(owner("user_id")).toEqual({ type: "owner", column: "user_id" });
  });

  it("rejects an empty column name", () => {
    expect(() => owner("")).toThrow(/non-empty column name/);
    expect(() => owner("   ")).toThrow(/non-empty column name/);
  });
});

describe("authenticated", () => {
  it("creates an authenticated expression node", () => {
    expect(authenticated()).toEqual({ type: "authenticated" });
  });
});

describe("publicAccess", () => {
  it("creates a public expression node", () => {
    expect(publicAccess()).toEqual({ type: "public" });
  });
});

describe("role", () => {
  it("creates a role expression node", () => {
    expect(role("admin")).toEqual({ type: "role", role: "admin" });
  });

  it("rejects an empty role name", () => {
    expect(() => role("")).toThrow(/non-empty role name/);
  });
});

describe("and", () => {
  it("combines expressions", () => {
    expect(and(authenticated(), owner("user_id"))).toEqual({
      type: "and",
      expressions: [{ type: "authenticated" }, { type: "owner", column: "user_id" }],
    });
  });

  it("requires at least two expressions", () => {
    expect(() => and(authenticated())).toThrow(/at least two expressions/);
  });
});

describe("or", () => {
  it("combines expressions", () => {
    expect(or(role("admin"), owner("user_id"))).toEqual({
      type: "or",
      expressions: [
        { type: "role", role: "admin" },
        { type: "owner", column: "user_id" },
      ],
    });
  });

  it("requires at least two expressions", () => {
    expect(() => or(authenticated())).toThrow(/at least two expressions/);
  });
});

describe("not", () => {
  it("wraps an expression", () => {
    expect(not(authenticated())).toEqual({
      type: "not",
      expression: { type: "authenticated" },
    });
  });
});
