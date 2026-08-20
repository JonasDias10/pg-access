import type { AndExpressionNode, ExpressionNode } from "../ast/nodes.js";

/** All of the given expressions must grant access. */
export function and(...expressions: readonly ExpressionNode[]): AndExpressionNode {
  if (expressions.length < 2) {
    throw new Error("and(...) requires at least two expressions.");
  }
  return { type: "and", expressions };
}
