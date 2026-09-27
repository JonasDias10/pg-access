import type { AuthNode, Operation } from "@pg-access/core";
import { OPERATIONS } from "@pg-access/core";
import type { CompiledPolicy } from "../compiler/policies.js";
import { compilePolicy } from "../compiler/policies.js";
import type { Dialect } from "../dialect/postgres.js";
import { postgresDialect } from "../dialect/postgres.js";
import type { PolicyChange, PolicyChangePlan } from "../diff/plan-policy-changes.js";
import { changeFor, planRollback, renderPlan, rolesEqual } from "../diff/render-plan.js";

export const SNAPSHOT_VERSION = 1;

/**
 * One policy as `compile()` produced it when the snapshot was taken. Same
 * fields as `ManagedPolicy`, but these are compiled SQL, not PostgreSQL's
 * reconstruction from `pg_policies`; only ever compare them against other
 * compiled SQL.
 */
export interface SnapshotPolicy {
  readonly table: string;
  readonly operation: Operation;
  readonly name: string;
  readonly roles: readonly string[];
  readonly using: string | null;
  readonly withCheck: string | null;
}

/**
 * The policies pg-access last generated a migration for, so the next
 * `generate` can diff against it without a database. A claim about the
 * database, not the database: it can't see a policy changed by hand or a
 * migration that was never applied, which is what `check` against a live
 * database is for.
 */
export interface PolicySnapshot {
  readonly version: typeof SNAPSHOT_VERSION;
  readonly policies: readonly SnapshotPolicy[];
}

export interface SnapshotOptions {
  /** Overrides how the portable AST maps onto concrete SQL. Defaults to {@link postgresDialect}. */
  readonly dialect?: Dialect;
}

const OPERATION_ORDER = new Map(OPERATIONS.map((op, index) => [op, index]));

function compileAll(auth: AuthNode, dialect: Dialect): CompiledPolicy[] {
  return auth.tables.flatMap((table) =>
    table.rowPolicies.map((rowPolicy) => compilePolicy(table.name, rowPolicy, dialect)),
  );
}

/**
 * Field order here is the order in the serialized file, and policies are
 * sorted by table then operation, so the same config always produces the
 * same bytes whatever order its tables and operations were declared in.
 */
function toSnapshotPolicy(policy: SnapshotPolicy | CompiledPolicy): SnapshotPolicy {
  return {
    table: policy.table,
    operation: policy.operation,
    name: policy.name,
    roles: "roles" in policy ? [...policy.roles].sort() : [policy.role],
    using: policy.using,
    withCheck: policy.withCheck,
  };
}

function sortPolicies(policies: readonly SnapshotPolicy[]): SnapshotPolicy[] {
  return [...policies].sort(
    (a, b) =>
      a.table.localeCompare(b.table) ||
      (OPERATION_ORDER.get(a.operation) ?? 0) - (OPERATION_ORDER.get(b.operation) ?? 0),
  );
}

/** Snapshots what `compile(auth)` produces: the state the database is in once its migration is applied. */
export function createSnapshot(auth: AuthNode, options: SnapshotOptions = {}): PolicySnapshot {
  const dialect = options.dialect ?? postgresDialect;

  return {
    version: SNAPSHOT_VERSION,
    policies: sortPolicies(compileAll(auth, dialect).map(toSnapshotPolicy)),
  };
}

/**
 * Deterministic JSON for a snapshot file: fixed field order, sorted
 * policies, two-space indent, trailing newline. Regenerating from an
 * unchanged config is byte-identical, so the file only shows up in a diff
 * when the policies did change.
 */
export function serializeSnapshot(snapshot: PolicySnapshot): string {
  const normalized: PolicySnapshot = {
    version: snapshot.version,
    policies: sortPolicies(snapshot.policies.map(toSnapshotPolicy)),
  };

  // `roles` goes on one line (a policy has one or two), which is also how
  // Prettier formats a short array, so a formatter run over the repo leaves
  // the file byte-identical and it never shows up as modified. Each array is
  // swapped for an index placeholder, then spliced back in as inline JSON.
  const inlineRoles: string[] = [];
  const json = JSON.stringify(
    normalized,
    (key, value: unknown) => {
      if (key === "roles" && Array.isArray(value)) {
        inlineRoles.push(`[${value.map((role) => JSON.stringify(role)).join(", ")}]`);
        return inlineRoles.length - 1;
      }
      return value;
    },
    2,
  ).replace(/"roles": (\d+)/g, (_match, index: string) => `"roles": ${inlineRoles[Number(index)]}`);

  return `${json}\n`;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSnapshotPolicy(value: unknown): value is SnapshotPolicy {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const policy = value as Record<string, unknown>;

  return (
    typeof policy["table"] === "string" &&
    typeof policy["name"] === "string" &&
    (OPERATIONS as readonly unknown[]).includes(policy["operation"]) &&
    Array.isArray(policy["roles"]) &&
    policy["roles"].every((role) => typeof role === "string") &&
    isStringOrNull(policy["using"]) &&
    isStringOrNull(policy["withCheck"])
  );
}

/**
 * Parses a snapshot file's contents. Throws on anything that isn't a
 * snapshot this version understands, rather than diffing against a
 * half-read file and emitting a wrong migration.
 */
export function parseSnapshot(text: string): PolicySnapshot {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("pg-access snapshot is not valid JSON.", { cause: error });
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("pg-access snapshot must be a JSON object.");
  }

  const { version, policies } = parsed as Record<string, unknown>;

  if (version !== SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported pg-access snapshot version ${JSON.stringify(version)}; ` +
        `this version of pg-access reads version ${SNAPSHOT_VERSION}.`,
    );
  }

  if (!Array.isArray(policies) || !policies.every(isSnapshotPolicy)) {
    throw new Error("pg-access snapshot has a malformed `policies` list.");
  }

  return { version, policies };
}

/**
 * The snapshot counterpart of `planPolicyChanges()`: the same
 * `create` / `alter` / `noop` / `drop` decisions and the same SQL, but
 * against the last snapshot instead of a live database, so it needs no
 * connection. Both sides are `compile()` output in the same form, so a plain
 * structural compare is enough; there's no normalization round trip.
 *
 * Differences from the live diff, both because the snapshot is only a
 * claim about the database:
 *
 * - Every `create` is preceded by `drop policy if exists`, so a policy that
 *   exists anyway doesn't fail the migration.
 * - `down` never turns RLS back off; the snapshot doesn't know whether it
 *   was off before, and leaving it on fails closed.
 *
 * Like the live diff, it only looks at tables the config still declares: a
 * table removed from the config entirely has its policies left alone (it
 * may already be gone, and `drop policy` on a missing table fails).
 */
export function planSnapshotChanges(
  snapshot: PolicySnapshot,
  auth: AuthNode,
  options: SnapshotOptions = {},
): PolicyChangePlan {
  const dialect = options.dialect ?? postgresDialect;

  const tableNames = new Set(auth.tables.map((table) => table.name));
  const declaredTables = auth.tables.filter((table) => table.rowPolicies.length > 0);

  const previous = snapshot.policies.filter((policy) => tableNames.has(policy.table));
  const previousByName = new Map(previous.map((policy) => [policy.name, policy]));

  const desired = compileAll(auth, dialect);
  const compiledByName = new Map(desired.map((policy) => [policy.name, policy]));
  const changes: PolicyChange[] = [];

  for (const policy of desired) {
    const before = previousByName.get(policy.name);

    if (before === undefined) {
      changes.push(changeFor(policy, "create"));
      continue;
    }

    const unchanged =
      before.using === policy.using &&
      before.withCheck === policy.withCheck &&
      rolesEqual(before.roles, [policy.role]);

    changes.push(changeFor(policy, unchanged ? "noop" : "alter"));
  }

  for (const policy of sortPolicies(previous)) {
    if (!compiledByName.has(policy.name)) {
      changes.push(changeFor(policy, "drop"));
    }
  }

  const statements = renderPlan(changes, declaredTables, compiledByName, previousByName, {
    guardCreates: true,
  });

  return {
    changes,
    statements,
    sql: statements.length > 0 ? `${statements.join("\n\n")}\n` : "",
    down: planRollback(changes, previousByName, () => false),
  };
}
