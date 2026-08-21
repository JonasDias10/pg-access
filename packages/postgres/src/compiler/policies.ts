import type { ExpressionNode, Operation, RowPolicyNode } from "@pg-access/core";
import type { Dialect } from "../dialect/postgres.js";
import { compileExpression } from "./expressions.js";
import { quoteIdent, quoteRole } from "./identifiers.js";

export function policyName(table: string, operation: Operation): string {
  return `${table}_${operation}`;
}

/**
 * Picks the `TO` role for a policy. This is a performance optimization
 * only. PostgreSQL skips evaluating `USING`/`WITH CHECK` entirely for
 * requests outside the granted role, so scoping `owner()`/`authenticated()`/
 * `role()` policies to the `authenticated` role avoids wasted work for
 * anonymous requests. It can never *grant* access the compiled boolean
 * expression wouldn't already grant, so getting it conservative (falling
 * back to `authenticated`) is always safe, only ever a missed optimization.
 */
function roleForExpression(expression: ExpressionNode, dialect: Dialect): string {
  return expression.type === "public" ? dialect.publicRole : dialect.authenticatedRole;
}

export interface CompiledPolicy {
  readonly table: string;
  readonly operation: Operation;
  readonly name: string;
  readonly role: string;
  readonly using: string | null;
  readonly withCheck: string | null;
}

/**
 * Places the compiled condition into `USING` and/or `WITH CHECK` according
 * to PostgreSQL's rules for each operation:
 *  - SELECT / DELETE: `USING` only (there is no new row to check).
 *  - INSERT: `WITH CHECK` only (there is no existing row to filter with
 *    `USING`, PostgreSQL rejects an INSERT policy that defines one).
 *  - UPDATE: both. `USING` filters which existing rows may be targeted,
 *    `WITH CHECK` validates the row *after* the update. This MVP applies
 *    the same expression to both, since the DSL only accepts one
 *    expression per operation; expressing "read with X, write with Y" is
 *    future work.
 */
export function compilePolicy(
  table: string,
  policy: RowPolicyNode,
  dialect: Dialect,
): CompiledPolicy {
  const condition = compileExpression(policy.expression, dialect);
  const role = roleForExpression(policy.expression, dialect);
  const name = policyName(table, policy.operation);

  switch (policy.operation) {
    case "select":
    case "delete":
      return {
        table,
        operation: policy.operation,
        name,
        role,
        using: condition,
        withCheck: null,
      };
    case "insert":
      return {
        table,
        operation: policy.operation,
        name,
        role,
        using: null,
        withCheck: condition,
      };
    case "update":
      return {
        table,
        operation: policy.operation,
        name,
        role,
        using: condition,
        withCheck: condition,
      };
  }
}

/**
 * Takes just the name/table a policy needs to be dropped, not a full
 * `CompiledPolicy` - also used to drop orphaned policies `compile()` never
 * computed a `CompiledPolicy` for in the first place (see its
 * `existingPolicies` option).
 */
export function renderDropPolicy(policy: {
  readonly table: string;
  readonly name: string;
}): string {
  return `drop policy if exists ${quoteIdent(policy.name)} on ${quoteIdent(policy.table)};`;
}

/**
 * `CREATE POLICY` errors if a policy with the same name already exists on
 * the table, it does not replace it. Since `policyName()` is deterministic
 * (`<table>_<operation>`), regenerating a migration after only changing a
 * policy's expression would otherwise re-emit the exact same name and fail
 * to apply against a database that already has the previous version. This
 * makes every regenerated migration self-contained: safe to apply against
 * either a fresh database (the `if exists` is a no-op) or one that already
 * has an older version of the same policy (it gets replaced).
 */
export function renderDropPolicyIfExists(policy: CompiledPolicy): string {
  return renderDropPolicy(policy);
}

export function renderCreatePolicy(policy: CompiledPolicy): string {
  const lines = [
    `create policy ${quoteIdent(policy.name)}`,
    `on ${quoteIdent(policy.table)}`,
    `for ${policy.operation}`,
    `to ${quoteRole(policy.role)}`,
  ];

  if (policy.using !== null) {
    lines.push(`using (\n  ${policy.using}\n)`);
  }
  if (policy.withCheck !== null) {
    lines.push(`with check (\n  ${policy.withCheck}\n)`);
  }

  return lines.join("\n") + ";";
}
