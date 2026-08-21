import { quoteRole } from "@pg-access/postgres";
import type { Pool, PoolClient } from "pg";

export interface AsUserOptions {
  /**
   * JWT claims to simulate as `request.jwt.claims`, the session setting
   * Supabase-style `auth.uid()`/`auth.jwt()` helpers read from (see
   * `@pg-access/postgres`'s default dialect). Omit or pass `null` to
   * simulate an unauthenticated request - no claims are set at all, not
   * an empty object, matching a request with no JWT.
   */
  readonly claims?: Record<string, unknown> | null;
  /**
   * PostgreSQL role to run as (`SET LOCAL ROLE`). Defaults to
   * `"authenticated"`, matching `@pg-access/postgres`'s default dialect and
   * Supabase's own role naming.
   */
  readonly role?: string;
}

/**
 * Runs `run` as a simulated end user against a real PostgreSQL database:
 * switches to `role` and sets `request.jwt.claims` for the duration of a
 * transaction that's always rolled back afterward, whether `run` succeeds
 * or throws - so a test using this never leaves data behind and never
 * needs its own cleanup for whatever `run` wrote.
 *
 * This is the same pattern `@pg-access/postgres`'s own integration test
 * suite uses to verify compiled RLS policies against a real server;
 * packaged here so a project consuming `@pg-access/core`/`@pg-access/postgres`
 * can write the same kind of test against its own schema.
 */
export async function asUser<T>(
  pool: Pool,
  options: AsUserOptions,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${quoteRole(options.role ?? "authenticated")};`);
    if (options.claims != null) {
      await client.query("select set_config('request.jwt.claims', $1, true);", [
        JSON.stringify(options.claims),
      ]);
    }
    return await run(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}
