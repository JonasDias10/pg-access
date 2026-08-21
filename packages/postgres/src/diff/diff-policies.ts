import type { AuthNode } from "@pg-access/core";
import { policyName } from "../compiler/policies.js";
import type { ManagedPolicy } from "../introspect/list-managed-policies.js";

export interface PolicyRef {
  readonly table: string;
  readonly name: string;
}

export interface PolicyDiffResult {
  /** Declared in the config, not yet applied to the database. */
  readonly missing: readonly PolicyRef[];
  /** Applied to the database, no longer declared in the config. */
  readonly orphaned: readonly PolicyRef[];
}

/**
 * Compares a config's expected policies against what `listManagedPolicies()`
 * found applied. Scoped to tables the config still declares: `existing` was
 * only ever fetched for those tables, so a table removed from the config
 * entirely is invisible here rather than showing up as fully orphaned.
 * Detecting that needs scanning every policy in the schema, not just the
 * ones this config's tables would produce - out of scope for this first
 * pass (see the compiler's own note on the same limitation).
 */
export function diffPolicies(auth: AuthNode, existing: readonly ManagedPolicy[]): PolicyDiffResult {
  const missing: PolicyRef[] = [];
  const orphaned: PolicyRef[] = [];

  for (const table of auth.tables) {
    const expectedNames = new Set(
      table.rowPolicies.map((policy) => policyName(table.name, policy.operation)),
    );
    const existingNames = new Set(
      existing.filter((policy) => policy.table === table.name).map((policy) => policy.name),
    );

    for (const name of expectedNames) {
      if (!existingNames.has(name)) {
        missing.push({ table: table.name, name });
      }
    }
    for (const name of existingNames) {
      if (!expectedNames.has(name)) {
        orphaned.push({ table: table.name, name });
      }
    }
  }

  return { missing, orphaned };
}
