import type { PolicyDiffResult } from "@pg-access/postgres";
import { diffPolicies, listManagedPolicies } from "@pg-access/postgres";
import pg from "pg";
import { resolveConfigPathOrThrow } from "../config/resolve-config-path.js";
import { loadAuthConfig } from "../config/load-config.js";

export interface CheckOptions {
  readonly cwd: string;
  readonly config?: string;
  readonly databaseUrl?: string;
}

export interface CheckResult extends PolicyDiffResult {
  readonly configPath: string;
}

/**
 * Read-only: reports drift between the config and what's actually applied
 * to a live database, it never modifies either side. Fixing "missing"
 * means running `generate` (and applying the result); fixing "orphaned"
 * is left as a manual `drop policy`, deliberately not automated here -
 * dropping a policy against a real database isn't something this command
 * should ever do without the user reviewing it first.
 */
export async function runCheck(options: CheckOptions): Promise<CheckResult> {
  const configPath = resolveConfigPathOrThrow(options.cwd, options.config);
  const auth = await loadAuthConfig(configPath);

  const connectionString = options.databaseUrl ?? process.env["DATABASE_URL"];
  if (connectionString === undefined) {
    throw new Error(
      "No database to check against. Pass --database-url <url> or set the DATABASE_URL environment variable.",
    );
  }

  const pool = new pg.Pool({ connectionString });
  try {
    const existing = await listManagedPolicies(
      pool,
      auth.tables.map((table) => table.name),
    );
    const diff = diffPolicies(auth, existing);
    return { configPath, ...diff };
  } finally {
    await pool.end();
  }
}
