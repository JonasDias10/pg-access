import type { Operation } from "@pg-access/core";
import { OPERATIONS } from "@pg-access/core";
import { policyName } from "../compiler/policies.js";

/**
 * Duck-typed to whatever `pg`'s `Pool`/`Client`/`PoolClient` already satisfy,
 * so this package doesn't need a runtime dependency on `pg` just to describe
 * the one method it calls. The actual connection is the caller's concern
 * (e.g. the CLI's `check` command).
 */
export interface PgQueryable {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

export interface ManagedPolicy {
  readonly table: string;
  readonly operation: Operation;
  readonly name: string;
}

interface PolicyRow {
  readonly tablename: string;
  readonly policyname: string;
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

  const result = await client.query(
    "select tablename, policyname from pg_policies where schemaname = 'public' and tablename = any($1)",
    [tables],
  );

  const managed: ManagedPolicy[] = [];
  for (const row of result.rows as PolicyRow[]) {
    const operation = OPERATIONS.find((op) => policyName(row.tablename, op) === row.policyname);
    if (operation !== undefined) {
      managed.push({ table: row.tablename, operation, name: row.policyname });
    }
  }

  return managed;
}
