import type { AuthNode, Operation } from "@pg-access/core";
import { quoteIdent } from "../compiler/identifiers.js";
import type { CompiledPolicy } from "../compiler/policies.js";
import { compilePolicy, renderCreatePolicy } from "../compiler/policies.js";
import type { Dialect } from "../dialect/postgres.js";
import { postgresDialect } from "../dialect/postgres.js";
import type {
  ManagedPolicy,
  PgPolicyRow,
  PgQueryable,
  PgTableRow,
} from "../introspect/list-managed-policies.js";
import {
  POLICY_COLUMNS,
  listManagedPolicies,
  toManagedPolicy,
} from "../introspect/list-managed-policies.js";
import type { Rollback } from "../migrations/rollback.js";
import { changeFor, planRollback, renderPlan, rolesEqual } from "./render-plan.js";

/**
 * - `create`: declared in the config, not applied yet.
 * - `alter`: applied, but its compiled `USING` / `WITH CHECK` / `TO` no
 *   longer matches the config.
 * - `noop`: applied and already identical to the config; emits no SQL.
 * - `drop`: a pg-access-managed policy still applied, no longer declared.
 */
export type PolicyChangeKind = "create" | "alter" | "noop" | "drop";

export interface PolicyChange {
  readonly table: string;
  readonly operation: Operation;
  readonly name: string;
  readonly kind: PolicyChangeKind;
}

export interface PolicyChangePlan {
  readonly changes: readonly PolicyChange[];
  /** Every statement the migration needs, in apply order. Empty when every change is a `noop`. */
  readonly statements: readonly string[];
  /** `statements` joined for writing straight into a migration file. `""` when there is nothing to do. */
  readonly sql: string;
  /**
   * What undoes `statements`, for migration formats with a `down()`: drops
   * what was created, alters what was altered back to its applied
   * definition, recreates what was dropped, and turns RLS back off on tables
   * that had it off before. Empty exactly when `statements` is.
   */
  readonly down: Rollback;
}

export interface PlanPolicyChangesOptions {
  /** Overrides how the portable AST maps onto concrete SQL. Defaults to {@link postgresDialect}. */
  readonly dialect?: Dialect;
}

/** Which of `tables` exist, mapped to whether RLS is currently enabled on each. */
async function selectExistingTables(
  session: PgQueryable,
  tables: readonly string[],
): Promise<Map<string, boolean>> {
  if (tables.length === 0) {
    return new Map();
  }

  const result = await session.query(
    "select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = any($1)",
    [tables],
  );

  return new Map(
    (result.rows as PgTableRow[]).map((row) => [row.tablename, row.rowsecurity === true]),
  );
}

/**
 * Step 2 of {@link planPolicyChanges}: run the compiled policies through
 * PostgreSQL so their `USING` / `WITH CHECK` / roles come back in the same
 * reconstructed form `pg_policies` already reports the applied ones in, and
 * a plain string compare between the two becomes meaningful. Applies them in
 * a transaction that is always rolled back, keyed by policy name.
 *
 * Only called with policies that are *already applied* (candidates for
 * `noop` / `alter`) - a policy the database doesn't have yet is a `create`
 * regardless, so there is nothing to compare. The drop-and-recreate for the
 * whole batch goes out as one multi-statement string: the compiled SQL is
 * fully escaped, so it needs no parameters, and one round trip beats two
 * per policy.
 */
async function normalizeDesired(
  session: PgQueryable,
  desired: readonly CompiledPolicy[],
): Promise<Map<string, ManagedPolicy>> {
  const byName = new Map<string, ManagedPolicy>();

  if (desired.length === 0) {
    return byName;
  }

  const compiledByName = new Map(desired.map((policy) => [policy.name, policy]));
  const setup = desired
    .flatMap((policy) => [
      `drop policy if exists ${quoteIdent(policy.name)} on ${quoteIdent(policy.table)};`,
      renderCreatePolicy(policy),
    ])
    .join("\n");

  await session.query("begin");
  try {
    await session.query(setup);

    const normalized = await session.query(
      `select ${POLICY_COLUMNS} from pg_policies ` +
        "where schemaname = 'public' and tablename = any($1) and policyname = any($2)",
      [[...new Set(desired.map((policy) => policy.table))], [...compiledByName.keys()]],
    );

    for (const row of normalized.rows as PgPolicyRow[]) {
      const match = compiledByName.get(row.policyname);

      if (match !== undefined && match.table === row.tablename) {
        byName.set(row.policyname, toManagedPolicy(row, match.operation));
      }
    }
  } finally {
    await session.query("rollback").catch(() => undefined);
  }

  return byName;
}

/**
 * Computes the smallest set of DDL that makes a live database's
 * pg-access-managed policies match `auth`, plus a per-policy breakdown of
 * what it decided. This is the database-aware counterpart to `compile()`,
 * which re-emits every policy as `drop` + `create` because it has nothing to
 * diff against.
 *
 * How it decides:
 *
 *  1. Read the managed policies already applied to the config's tables
 *     (`listManagedPolicies()`), with their `USING` / `WITH CHECK` / roles
 *     exactly as PostgreSQL reconstructs them in `pg_policies`.
 *  2. Compile the config's policies and normalize them the same way (see
 *     {@link normalizeDesired}). Two values PostgreSQL itself reconstructed
 *     compare reliably; compiled SQL string-matched against `pg_policies`
 *     does not, since PostgreSQL re-parenthesizes, schema-qualifies and
 *     makes casts explicit.
 *  3. Per policy name:
 *       - in the config, not applied .............. `create`
 *       - applied, normalized forms equal ......... `noop` (emits nothing)
 *       - applied, normalized forms differ ........ `alter` (one
 *         `ALTER POLICY` resets `TO` / `USING` / `WITH CHECK`; the command
 *         is fixed by the policy name, so it is never dropped)
 *       - applied and managed, not in the config .. `drop`
 *
 * `sql` is `""` when every policy is a `noop`, so the caller can skip
 * writing a migration entirely.
 *
 * `session` must be a single connection (a `pg` `PoolClient`), never a
 * `Pool`, because step 2 spans one transaction. That step runs only for
 * policies that are already applied (the ones that might be `noop` or
 * `alter`), as one batched round trip, and is skipped entirely when nothing
 * needs comparing - a first migration, or one that only adds policies,
 * never opens it. While open it briefly takes an `ACCESS EXCLUSIVE` lock on
 * each table it touches and needs a role allowed to create policies there -
 * the same role that will apply the migration. Tables the config names but
 * that don't exist yet can't be normalized, so their policies come back as
 * `create`.
 */
export async function planPolicyChanges(
  session: PgQueryable,
  auth: AuthNode,
  options: PlanPolicyChangesOptions = {},
): Promise<PolicyChangePlan> {
  const dialect = options.dialect ?? postgresDialect;

  // Every table still named by the config, even one whose `rows` is now
  // empty: its managed policies still need to be seen so they can be
  // dropped. `declaredTables` (below) is the subset that still produces SQL.
  const tableNames = auth.tables.map((table) => table.name);
  const declaredTables = auth.tables.filter((table) => table.rowPolicies.length > 0);

  const existing = await listManagedPolicies(session, tableNames);
  const existingByName = new Map(existing.map((policy) => [policy.name, policy]));

  const liveTables = await selectExistingTables(session, tableNames);

  const desired: CompiledPolicy[] = [];
  for (const table of declaredTables) {
    for (const rowPolicy of table.rowPolicies) {
      desired.push(compilePolicy(table.name, rowPolicy, dialect));
    }
  }

  // Only policies that already exist on a live table can be `noop` or
  // `alter`; everything else is a `create`, which needs no normalization
  // round trip. So a first migration, or one that only adds policies, never
  // opens the transaction at all.
  const normalizedDesired = await normalizeDesired(
    session,
    desired.filter((policy) => liveTables.has(policy.table) && existingByName.has(policy.name)),
  );

  const compiledByName = new Map(desired.map((policy) => [policy.name, policy]));
  const changes: PolicyChange[] = [];

  for (const policy of desired) {
    const applied = existingByName.get(policy.name);

    if (applied === undefined) {
      changes.push(changeFor(policy, "create"));
      continue;
    }

    const target = normalizedDesired.get(policy.name);
    const unchanged =
      target !== undefined &&
      target.using === applied.using &&
      target.withCheck === applied.withCheck &&
      rolesEqual(target.roles, applied.roles);

    changes.push(changeFor(policy, unchanged ? "noop" : "alter"));
  }

  for (const policy of existing) {
    if (!compiledByName.has(policy.name)) {
      changes.push(changeFor(policy, "drop"));
    }
  }

  const statements = renderPlan(changes, declaredTables, compiledByName, existingByName);

  return {
    changes,
    statements,
    sql: statements.length > 0 ? `${statements.join("\n\n")}\n` : "",
    // A table that didn't exist yet had RLS off too: the migration creating
    // it runs its own `down` after this one.
    down: planRollback(changes, existingByName, (table) => liveTables.get(table) !== true),
  };
}
