import type { DataSource, EntityManager } from "typeorm";

export interface RequestUser {
  /** The user's id; what `auth.uid()` returns and `owner()` compares against. */
  readonly id: string;
  /** Application role, read by `role()` from the JWT's `app_metadata`. */
  readonly role?: string;
}

/**
 * Runs `fn` with RLS evaluating as `user`: inside one transaction, switch to
 * the `authenticated` role the generated policies are granted to and set
 * `request.jwt.claims`, which `auth.uid()` / `auth.jwt()` read (see the
 * AuthSchema migration). Both are `local`, so they end with the transaction
 * and never leak onto the next query that borrows the pooled connection.
 *
 * Everything `fn` does through `manager` is filtered and checked by the
 * policies; the data source's own login role is only used to connect.
 */
export function asUser<T>(
  dataSource: DataSource,
  user: RequestUser,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return dataSource.transaction(async (manager) => {
    await manager.query("set local role authenticated");
    await manager.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user.id, app_metadata: { role: user.role } }),
    ]);
    return fn(manager);
  });
}
