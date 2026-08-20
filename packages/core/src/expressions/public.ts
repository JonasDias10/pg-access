import type { PublicExpressionNode } from "../ast/nodes.js";

/** Grants access to everyone, including unauthenticated (anonymous) users. */
export function publicAccess(): PublicExpressionNode {
  return { type: "public" };
}
