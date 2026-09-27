import { quoteIdent, quoteRole } from "../compiler/identifiers.js";
import type { CompiledPolicy } from "../compiler/policies.js";
import { renderDropPolicy } from "../compiler/policies.js";
import type { ManagedPolicy } from "../introspect/list-managed-policies.js";

/**
 * The statements that undo a migration, in apply order. Plain `.sql`
 * migration tools (Supabase, drizzle-kit) have nowhere to put this; ORM
 * migrations built as `up()` / `down()` pairs (TypeORM, Kysely) do.
 */
export interface Rollback {
  readonly statements: readonly string[];
  /** `statements` joined the same way as the `up` SQL. `""` when there is nothing to undo. */
  readonly sql: string;
}

export interface RollbackInput {
  /** Policies the migration creates from nothing. Undone by dropping them. */
  readonly created: readonly Pick<CompiledPolicy, "table" | "name">[];
  /**
   * Policies the migration rewrites (an `ALTER POLICY`, or `compile()`'s
   * drop-then-recreate), as they were *before* it. Undone by altering them
   * back to this definition.
   */
  readonly replaced: readonly ManagedPolicy[];
  /** Policies the migration drops, as they were before it. Undone by recreating them. */
  readonly dropped: readonly ManagedPolicy[];
  /**
   * Tables the migration turns RLS on for that had it off before. Undone by
   * turning it back off. Leave a table out when its prior state is unknown:
   * a `down` that leaves RLS on with no policies denies everything, which
   * fails closed, while wrongly turning it off would fail open.
   */
  readonly enabledRls: readonly string[];
}

function renderRoles(roles: readonly string[]): string {
  // An empty `pg_policies.roles` can't happen for a real policy (PostgreSQL
  // stores `{public}` when `TO` is omitted), but `TO` with nothing after it
  // is a syntax error, so fall back to the same default.
  return roles.length > 0 ? roles.map(quoteRole).join(", ") : "public";
}

function renderClauses(policy: ManagedPolicy): string[] {
  const lines = [`to ${renderRoles(policy.roles)}`];

  if (policy.using !== null) {
    lines.push(`using (\n  ${policy.using}\n)`);
  }
  if (policy.withCheck !== null) {
    lines.push(`with check (\n  ${policy.withCheck}\n)`);
  }

  return lines;
}

/**
 * Recreates a policy from its `pg_policies` state. `using` / `withCheck` are
 * PostgreSQL's own deparsed expressions there (the same text `pg_dump`
 * would emit), so they are valid SQL to apply back as-is.
 */
function renderRecreatePolicy(policy: ManagedPolicy): string {
  const lines = [
    `create policy ${quoteIdent(policy.name)}`,
    `on ${quoteIdent(policy.table)}`,
    `for ${policy.operation}`,
    ...renderClauses(policy),
  ];

  return lines.join("\n") + ";";
}

function renderRestorePolicy(policy: ManagedPolicy): string {
  const lines = [
    `alter policy ${quoteIdent(policy.name)}`,
    `on ${quoteIdent(policy.table)}`,
    ...renderClauses(policy),
  ];

  return lines.join("\n") + ";";
}

/**
 * Builds the `down` counterpart of a migration from what it changed and the
 * state it changed it from. Shared by `compile()` and `planPolicyChanges()`
 * so every ORM adapter gets the same rollback semantics.
 *
 * Order mirrors the `up` in reverse: dropped policies come back first, then
 * rewritten ones return to their previous definition, then created ones go,
 * and RLS is turned off last so a table is never briefly open while its
 * policies are still being put back. Each bucket is sorted by name so the
 * output is stable between runs.
 */
export function renderRollback(input: RollbackInput): Rollback {
  const byName = <T extends { readonly name: string }>(items: readonly T[]): T[] =>
    [...items].sort((a, b) => a.name.localeCompare(b.name));

  const statements = [
    ...byName(input.dropped).map(renderRecreatePolicy),
    ...byName(input.replaced).map(renderRestorePolicy),
    ...byName(input.created).map(renderDropPolicy),
    ...[...input.enabledRls]
      .sort((a, b) => a.localeCompare(b))
      .map((table) => `alter table ${quoteIdent(table)} disable row level security;`),
  ];

  return {
    statements,
    sql: statements.length > 0 ? `${statements.join("\n\n")}\n` : "",
  };
}
