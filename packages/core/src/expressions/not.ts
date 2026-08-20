import type { ExpressionNode, NotExpressionNode } from "../ast/nodes.js";

/** Inverts the given expression. */
export function not(expression: ExpressionNode): NotExpressionNode {
  return { type: "not", expression };
}
