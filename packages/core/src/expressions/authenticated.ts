import type { AuthenticatedExpressionNode } from "../ast/nodes.js";

/** Grants access to any signed-in user, regardless of identity or role. */
export function authenticated(): AuthenticatedExpressionNode {
  return { type: "authenticated" };
}
