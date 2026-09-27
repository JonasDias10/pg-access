import type { AuthNode } from "@pg-access/core";
import { OPERATIONS } from "@pg-access/core";
import { quoteIdent } from "../compiler/identifiers.js";
import type { CompiledPolicy } from "../compiler/policies.js";
import {
  renderAlterPolicy,
  renderCreatePolicy,
  renderDropPolicy,
  renderDropPolicyIfExists,
} from "../compiler/policies.js";
import type { ManagedPolicy } from "../introspect/list-managed-policies.js";
import type { Rollback } from "../migrations/rollback.js";
import { renderRollback } from "../migrations/rollback.js";
import type { PolicyChange, PolicyChangeKind } from "./plan-policy-changes.js";

/**
 * What `planPolicyChanges()` (against a live database) and
 * `planSnapshotChanges()` (against a snapshot) share once each has decided
 * its `changes`: turning them into the migration's statements and its
 * rollback. Internal; not exported from the package.
 */

const OPERATION_ORDER = new Map(OPERATIONS.map((op, index) => [op, index]));

/** `CompiledPolicy` and `ManagedPolicy` both carry the identity a `PolicyChange` needs. */
type PolicyIdentity = Pick<PolicyChange, "table" | "operation" | "name">;

export function changeFor(policy: PolicyIdentity, kind: PolicyChangeKind): PolicyChange {
  return { table: policy.table, operation: policy.operation, name: policy.name, kind };
}

export function rolesEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((role, index) => role === sortedB[index]);
}

export interface RenderPlanOptions {
  /**
   * Precede each `create policy` with `drop policy if exists`. A live diff
   * knows the policy isn't there; a snapshot only claims it, and a policy
   * that exists anyway (a merge that re-emits another branch's create, a
   * policy added by hand) would otherwise fail the whole migration.
   */
  readonly guardCreates?: boolean;
}

export function renderPlan(
  changes: readonly PolicyChange[],
  declaredTables: AuthNode["tables"],
  compiledByName: ReadonlyMap<string, CompiledPolicy>,
  existingByName: ReadonlyMap<string, ManagedPolicy>,
  options: RenderPlanOptions = {},
): string[] {
  const statements: string[] = [];

  // Bucket the emitting changes by table once, rather than re-scanning every
  // change for every declared table.
  const emitByTable = new Map<string, PolicyChange[]>();
  for (const change of changes) {
    if (change.kind === "create" || change.kind === "alter") {
      const bucket = emitByTable.get(change.table);
      if (bucket === undefined) {
        emitByTable.set(change.table, [change]);
      } else {
        bucket.push(change);
      }
    }
  }

  for (const table of declaredTables) {
    const tableChanges = emitByTable.get(table.name);
    if (tableChanges === undefined) {
      continue;
    }

    statements.push(`alter table ${quoteIdent(table.name)} enable row level security;`);

    const ordered = [...tableChanges].sort(
      (a, b) => (OPERATION_ORDER.get(a.operation) ?? 0) - (OPERATION_ORDER.get(b.operation) ?? 0),
    );

    for (const change of ordered) {
      const compiled = compiledByName.get(change.name);

      if (compiled === undefined) {
        continue;
      }

      if (change.kind === "create") {
        if (options.guardCreates === true) {
          statements.push(renderDropPolicyIfExists(compiled));
        }
        statements.push(renderCreatePolicy(compiled));
      } else {
        statements.push(renderAlterPolicy(compiled));
      }
    }
  }

  // `existing` comes back in `pg_policies` scan order, i.e. not
  // deterministic between runs; sort so regenerating a migration produces a
  // stable diff.
  const drops = changes
    .filter((change) => change.kind === "drop")
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const change of drops) {
    const applied = existingByName.get(change.name);

    if (applied !== undefined) {
      statements.push(renderDropPolicy(applied));
    }
  }

  return statements;
}

/**
 * The inverse of {@link renderPlan}, from the same `changes`. A table only
 * gets its RLS turned back off when `renderPlan` turned it on (it had a
 * `create` or `alter`) and `rlsWasOff` says it was off before.
 */
export function planRollback(
  changes: readonly PolicyChange[],
  existingByName: ReadonlyMap<string, ManagedPolicy>,
  rlsWasOff: (table: string) => boolean,
): Rollback {
  const created: PolicyChange[] = [];
  const replaced: ManagedPolicy[] = [];
  const dropped: ManagedPolicy[] = [];
  const enabledRls = new Set<string>();

  for (const change of changes) {
    const applied = existingByName.get(change.name);

    if (change.kind === "create") {
      created.push(change);
    } else if (change.kind === "alter" && applied !== undefined) {
      replaced.push(applied);
    } else if (change.kind === "drop" && applied !== undefined) {
      dropped.push(applied);
    }

    if ((change.kind === "create" || change.kind === "alter") && rlsWasOff(change.table)) {
      enabledRls.add(change.table);
    }
  }

  return renderRollback({ created, replaced, dropped, enabledRls: [...enabledRls] });
}
