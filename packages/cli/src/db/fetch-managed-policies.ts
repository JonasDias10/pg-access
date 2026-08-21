import type { ManagedPolicy } from "@pg-access/postgres";
import { listManagedPolicies } from "@pg-access/postgres";
import pg from "pg";

/**
 * Opens a short-lived connection just to run `listManagedPolicies()`, then
 * closes it. Shared by `generate` (optional, to also drop orphaned
 * policies) and `check` (required), so the connection-lifecycle handling
 * only lives in one place.
 */
export async function fetchManagedPolicies(
  connectionString: string,
  tables: readonly string[],
): Promise<ManagedPolicy[]> {
  const pool = new pg.Pool({ connectionString });
  try {
    return await listManagedPolicies(pool, tables);
  } finally {
    await pool.end();
  }
}
