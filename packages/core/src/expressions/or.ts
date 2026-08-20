import type { ExpressionNode, OrExpressionNode } from "../ast/nodes.js";

/** Any one of the given expressions may grant access. */
export function or(...expressions: readonly ExpressionNode[]): OrExpressionNode {
  if (expressions.length < 2) {
    throw new Error("or(...) requires at least two expressions.");
  }
  return { type: "or", expressions };
}
