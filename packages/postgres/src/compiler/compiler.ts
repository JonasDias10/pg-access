import type { AuthNode } from "@pg-access/core";
import type { Dialect } from "../dialect/postgres.js";
import { postgresDialect } from "../dialect/postgres.js";
import { quoteIdent } from "./identifiers.js";
import { compilePolicy, renderCreatePolicy, renderDropPolicyIfExists } from "./policies.js";

export interface CompileOptions {
  readonly dialect?: Dialect;
}

export interface CompileResult {
  /** The full generated SQL, statements separated by a blank line. */
  readonly sql: string;
  /** Each individual SQL statement, in execution order. */
  readonly statements: readonly string[];
}

/**
 * Compiles an `@pg-access/core` AST into PostgreSQL DDL: one
 * `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` plus one `CREATE POLICY` per
 * declared row policy, per table.
 *
 * A table with no row policies produces no statements at all. RLS is left
 * untouched rather than being force-enabled with zero policies, which would
 * silently deny all access. Declaring `rows: {}` is a no-op, not an
 * implicit "deny everything"; deliberately locking a table down still
 * requires writing at least one policy.
 *
 * Each policy is preceded by a `drop policy if exists` for its own name, so
 * regenerating a migration after changing a policy's expression is safe to
 * apply on top of a database that already has the previous version, not
 * just on a fresh one. This does not handle a row policy being removed
 * from the config entirely; that leaves the previously-applied policy in
 * place, since there is nothing in the new AuthNode telling the compiler
 * it used to exist.
 */
export function compile(auth: AuthNode, options: CompileOptions = {}): CompileResult {
  const dialect = options.dialect ?? postgresDialect;
  const statements: string[] = [];

  for (const table of auth.tables) {
    if (table.rowPolicies.length === 0) {
      continue;
    }

    statements.push(`alter table ${quoteIdent(table.name)} enable row level security;`);

    for (const rowPolicy of table.rowPolicies) {
      const compiled = compilePolicy(table.name, rowPolicy, dialect);
      statements.push(renderDropPolicyIfExists(compiled));
      statements.push(renderCreatePolicy(compiled));
    }
  }

  return {
    sql: statements.length > 0 ? `${statements.join("\n\n")}\n` : "",
    statements,
  };
}
