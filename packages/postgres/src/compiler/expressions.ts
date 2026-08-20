import type { ExpressionNode } from "@pg-access/core";
import type { Dialect } from "../dialect/postgres.js";
import { quoteIdent, quoteLiteral } from "./identifiers.js";

/**
 * Compiles an AST expression into a boolean SQL expression suitable for a
 * `USING` or `WITH CHECK` clause. This is the actual security boundary of
 * the generated policy. The `TO <role>` clause (see policies.ts) is only
 * an optimization on top of it, never a substitute for it.
 */
export function compileExpression(expression: ExpressionNode, dialect: Dialect): string {
  switch (expression.type) {
    case "owner":
      return `${quoteIdent(expression.column)} = ${dialect.currentUserIdExpression}`;
    case "authenticated":
      return `${dialect.currentUserIdExpression} is not null`;
    case "public":
      return "true";
    case "role":
      return dialect.roleExpression(quoteLiteral(expression.role));
    case "and":
      return `(${expression.expressions.map((child) => compileExpression(child, dialect)).join(" and ")})`;
    case "or":
      return `(${expression.expressions.map((child) => compileExpression(child, dialect)).join(" or ")})`;
    case "not":
      // SQL's `NOT` follows three-valued logic: NOT NULL is NULL, not
      // false; and a NULL in USING/WITH CHECK is treated as "no match",
      // same as false. That means plain `not (X)` silently excludes rows
      // where X was merely *undetermined* (e.g. `not(role("banned"))` for
      // a user with no role claim at all, who isn't banned but also isn't
      // provably not-banned under 2-valued logic), not just rows where X
      // was actually true. `IS NOT TRUE` is a real, standard SQL
      // comparison (unlike NOT, it never itself returns NULL) that treats
      // "unknown" the same as "false"; which is what `not(...)` in this
      // DSL is meant to mean: "excludes only rows definitely matching X".
      return `(${compileExpression(expression.expression, dialect)}) is not true`;
  }
}
