import type { RoleExpressionNode } from "../ast/nodes.js";

/**
 * Grants access to users carrying a given application role (e.g. "admin").
 * This is an application-level role coming from user claims, not a
 * PostgreSQL `ROLE`. How it's actually checked in SQL is a compiler
 * decision.
 */
export function role(name: string): RoleExpressionNode {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("role(name) requires a non-empty role name.");
  }
  return { type: "role", role: name };
}
