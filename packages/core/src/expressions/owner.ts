import type { OwnerExpressionNode } from "../ast/nodes.js";

/**
 * Grants access to rows where `column` matches the current authenticated
 * user. What "matches the current user" means concretely (e.g. Supabase's
 * `auth.uid()`) is decided by the compiler, not here.
 */
export function owner(column: string): OwnerExpressionNode {
  if (typeof column !== "string" || column.trim().length === 0) {
    throw new Error("owner(column) requires a non-empty column name.");
  }
  return { type: "owner", column };
}
