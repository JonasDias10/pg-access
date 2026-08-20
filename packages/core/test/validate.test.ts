import { describe, expect, it } from "vitest";
import { buildAuthNode } from "../src/ast/builders.js";
import { validate } from "../src/policy/policy.js";
import { and, authenticated, or, owner, role } from "../src/index.js";

describe("validate", () => {
  it("passes for a well-formed AST", () => {
    const auth = buildAuthNode({
      projects: { rows: { select: owner("user_id") } },
    });
    expect(validate(auth)).toEqual({ valid: true, errors: [] });
  });

  it("flags an empty table name", () => {
    const auth = buildAuthNode({
      "": { rows: { select: owner("user_id") } },
    });
    const result = validate(auth);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      path: "table",
      message: "Table name must not be empty.",
    });
  });

  it("recursively flags invalid expressions nested in and/or", () => {
    // Built by hand (bypassing owner()'s own guard) to exercise the
    // recursive validator on a deeply nested malformed expression.
    const auth = buildAuthNode({
      projects: {
        rows: {
          select: and(authenticated(), or({ type: "owner", column: "" }, authenticated())),
        },
      },
    });
    const result = validate(auth);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe("projects.rows.select.and[1].or[0]");
  });

  it("flags a table name over PostgreSQL's 63-byte identifier limit", () => {
    const tooLong = "a".repeat(64);
    const auth = buildAuthNode({
      [tooLong]: { rows: { select: owner("user_id") } },
    });
    const result = validate(auth);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      path: "table",
      message: `"${tooLong}" is 64 bytes long; PostgreSQL silently truncates identifiers over 63 bytes.`,
    });
  });

  it("allows a table name at exactly the 63-byte limit", () => {
    const auth = buildAuthNode({
      [`a`.repeat(63)]: { rows: { select: owner("user_id") } },
    });
    expect(validate(auth).valid).toBe(true);
  });

  it("counts identifier length in UTF-8 bytes, not characters", () => {
    // "é" is 1 character but 2 bytes in UTF-8, so 32 of them is 64 bytes -
    // over the limit even though .length in JS would report 32.
    const tooLong = "é".repeat(32);
    const auth = buildAuthNode({
      projects: { rows: { select: owner(tooLong) } },
    });
    const result = validate(auth);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain("64 bytes long");
  });

  it("flags an over-length column name from owner() and role name from role()", () => {
    const tooLong = "b".repeat(64);
    const auth = buildAuthNode({
      projects: {
        rows: {
          select: owner(tooLong),
          update: role(tooLong),
        },
      },
    });
    const result = validate(auth);
    expect(result.errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(["projects.rows.select", "projects.rows.update"]),
    );
  });
});
