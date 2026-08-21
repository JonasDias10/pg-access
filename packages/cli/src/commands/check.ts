import type { PolicyDiffResult } from "@pg-access/postgres";
import { diffPolicies } from "@pg-access/postgres";
import { fetchManagedPolicies } from "../db/fetch-managed-policies.js";
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
 * means running `generate --database-url` (which drops them in the
 * generated migration, still nothing applied directly by this command).
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

  const existing = await fetchManagedPolicies(
    connectionString,
    auth.tables.map((table) => table.name),
  );
  const diff = diffPolicies(auth, existing);
  return { configPath, ...diff };
}
