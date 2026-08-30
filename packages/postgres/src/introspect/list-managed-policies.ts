import type { Operation } from "@pg-access/core";
import { OPERATIONS } from "@pg-access/core";
import { policyName } from "../compiler/policies.js";

/**
 * Duck-typed to whatever `pg`'s `Pool`/`Client`/`PoolClient` already satisfy,
 * so this package doesn't need a runtime dependency on `pg` just to describe
 * the one method it calls. The actual connection is the caller's concern
 * (e.g. the CLI's `check` command).
 *
 * `listManagedPolicies()` only reads, so a `Pool` is fine. `planPolicyChanges()`
 * runs a transaction and must get a single session (a `PoolClient` from
 * `pool.connect()`), never a `Pool`, whose calls can land on different
 * backends.
 */
export interface PgQueryable {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

export interface ManagedPolicy {
  readonly table: string;
  readonly operation: Operation;
  readonly name: string;
  /**
   * `USING` / `WITH CHECK` expressions and `TO` roles exactly as PostgreSQL
   * reconstructs them in `pg_policies` (schema-qualified, re-parenthesized,
   * casts made explicit). Only meaningful when compared against another
   * value from the same source, which is what `planPolicyChanges()` does -
   * never string-compare these against freshly compiled SQL.
   */
  readonly using: string | null;
  readonly withCheck: string | null;
  readonly roles: readonly string[];
}

/** One row of a `pg_policies` query built with {@link POLICY_COLUMNS}. */
export interface PgPolicyRow {
  readonly tablename: string;
  readonly policyname: string;
  readonly qual: string | null;
  readonly with_check: string | null;
  readonly roles: string | null;
}

/** One row of a `pg_tables` query, naming a table in the `public` schema. */
export interface PgTableRow {
  readonly tablename: string;
}

/**
 * The `pg_policies` columns `listManagedPolicies()` and `planPolicyChanges()`
 * both select. `roles` is a `name[]`, which the `pg` driver hands back as the
 * raw array literal (`{authenticated,anon}`) unless a type parser is
 * registered, so `array_to_string` collapses it to a plain comma string.
 */
export const POLICY_COLUMNS =
  "tablename, policyname, qual, with_check, array_to_string(roles, ',') as roles";

const SELECT_MANAGED_POLICIES =
  `select ${POLICY_COLUMNS} from pg_policies ` +
  "where schemaname = 'public' and tablename = any($1)";

export function parseRoleList(value: string | null | undefined): string[] {
  return value === null || value === undefined || value === "" ? [] : value.split(",");
}

/** Reshapes a raw `pg_policies` row into a {@link ManagedPolicy}, given its resolved operation. */
export function toManagedPolicy(row: PgPolicyRow, operation: Operation): ManagedPolicy {
  return {
    table: row.tablename,
    operation,
    name: row.policyname,
    using: row.qual ?? null,
    withCheck: row.with_check ?? null,
    roles: parseRoleList(row.roles),
  };
}

/**
 * Reads which of pg-access's own policies (named `<table>_<operation>` by
 * `policyName()`) are currently applied to `tables` in the `public` schema.
 * Any other policy on those tables is ignored, not returned - a database can
 * have hand-written policies alongside compiled ones, and telling those
 * apart from pg-access's own is exactly what the naming convention is for.
 */
export async function listManagedPolicies(
  client: PgQueryable,
  tables: readonly string[],
): Promise<ManagedPolicy[]> {
  if (tables.length === 0) {
    return [];
  }

  const result = await client.query(SELECT_MANAGED_POLICIES, [tables]);

  const managed: ManagedPolicy[] = [];
  for (const row of result.rows as PgPolicyRow[]) {
    const operation = OPERATIONS.find((op) => policyName(row.tablename, op) === row.policyname);

    if (operation !== undefined) {
      managed.push(toManagedPolicy(row, operation));
    }
  }

  return managed;
}
