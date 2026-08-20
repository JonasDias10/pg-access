/**
 * A dialect decides how the *portable* concepts in the AST (owner,
 * authenticated, role, ...) map onto concrete PostgreSQL SQL. This is
 * deliberately a seam: `@pg-access/postgres` ships one default dialect that
 * targets vanilla PostgreSQL together with Supabase's `auth` schema helpers
 * (`auth.uid()`, `auth.jwt()`), because Supabase is this project's first
 * integration target and its auth helpers are themselves plain SQL
 * functions, not a runtime dependency. Projects that don't use Supabase's
 * `auth` schema can supply their own dialect (e.g. one that reads the
 * current user from `current_setting('app.user_id')`).
 */
export interface Dialect {
  /**
   * SQL expression that resolves to the current user's id. Wrapped in a
   * scalar subquery (`(select ...)`) so PostgreSQL can cache/inline it once
   * per statement instead of re-evaluating a volatile function per row.
   * This is the standard Supabase RLS performance recommendation.
   */
  readonly currentUserIdExpression: string;

  /** Postgres role granted to signed-in requests. */
  readonly authenticatedRole: string;

  /** Pseudo-role granting the policy to every request, signed in or not. */
  readonly publicRole: string;

  /**
   * Builds the boolean SQL expression used by `role(name)`, given `name`
   * already rendered as a safely-escaped SQL string literal (e.g. `'admin'`).
   */
  roleExpression(roleLiteral: string): string;
}

export const postgresDialect: Dialect = {
  currentUserIdExpression: "(select auth.uid())",
  authenticatedRole: "authenticated",
  publicRole: "public",
  roleExpression: (roleLiteral) =>
    `(select auth.jwt() -> 'app_metadata' ->> 'role') = ${roleLiteral}`,
};
