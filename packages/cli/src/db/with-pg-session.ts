import type { PgQueryable } from "@pg-access/postgres";
import pg from "pg";

/**
 * Checks out a single connection from a short-lived pool, hands it to `fn`,
 * and always releases it and drains the pool afterward. `generate` and
 * `check` both need one connection held for the length of the operation:
 * `planPolicyChanges()` runs a transaction on it, so a bare `Pool` (whose
 * calls may land on different backends) would not do.
 */
export async function withPgSession<T>(
  connectionString: string,
  fn: (session: PgQueryable) => Promise<T>,
): Promise<T> {
  const pool = new pg.Pool({ connectionString });
  try {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
