import { describe, expect, it } from "vitest";
import { quoteIdent, quoteLiteral, quoteRole } from "../../src/compiler/identifiers.js";

describe("quoteIdent", () => {
  it("wraps identifiers in double quotes", () => {
    expect(quoteIdent("projects")).toBe('"projects"');
  });

  it("escapes embedded double quotes by doubling them", () => {
    expect(quoteIdent('weird"table')).toBe('"weird""table"');
  });

  it("rejects an empty identifier", () => {
    expect(() => quoteIdent("")).toThrow(/empty SQL identifier/);
  });

  it("quotes a PostgreSQL reserved keyword as a safely usable identifier", () => {
    // "user", "order", "select" etc are reserved words; unquoted, they'd
    // be a syntax error. Naming a table "user" is extremely common, so
    // this needs to actually work, not just avoid crashing.
    expect(quoteIdent("user")).toBe('"user"');
    expect(quoteIdent("order")).toBe('"order"');
    expect(quoteIdent("select")).toBe('"select"');
  });

  it("keeps a semicolon inside the identifier text, not as a statement separator", () => {
    // Nothing about "col; drop table x; --" gets interpreted as SQL here:
    // between the quotes it's just characters in an identifier's name.
    expect(quoteIdent('col"; drop table x; --')).toBe('"col""; drop table x; --"');
  });

  it("preserves backslashes and unicode verbatim (no special meaning inside a quoted identifier)", () => {
    expect(quoteIdent("café_\\_data")).toBe('"café_\\_data"');
  });

  it("preserves embedded newlines", () => {
    expect(quoteIdent("weird\ncolumn")).toBe('"weird\ncolumn"');
  });
});

describe("quoteLiteral", () => {
  it("wraps values in single quotes", () => {
    expect(quoteLiteral("admin")).toBe("'admin'");
  });

  it("escapes embedded single quotes by doubling them, preventing injection", () => {
    expect(quoteLiteral("admin' or '1'='1")).toBe("'admin'' or ''1''=''1'");
  });
});

describe("quoteRole", () => {
  it("leaves the PUBLIC keyword unquoted", () => {
    expect(quoteRole("public")).toBe("public");
    expect(quoteRole("PUBLIC")).toBe("public");
  });

  it("quotes real role names as identifiers", () => {
    expect(quoteRole("authenticated")).toBe('"authenticated"');
  });
});
