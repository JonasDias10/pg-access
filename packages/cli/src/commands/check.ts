import type { PolicyChange } from "@pg-access/postgres";
import { planPolicyChanges } from "@pg-access/postgres";
import { loadAuthConfig } from "../config/load-config.js";
import { resolveConfigPathOrThrow } from "../config/resolve-config-path.js";
import { withPgSession } from "../db/with-pg-session.js";

export interface CheckOptions {
  readonly cwd: string;
  readonly config?: string;
  readonly databaseUrl?: string;
}

export interface CheckResult {
  readonly configPath: string;
  /** Declared in the config, not applied yet. */
  readonly missing: readonly PolicyChange[];
  /** Applied, but the compiled definition no longer matches the config. */
  readonly changed: readonly PolicyChange[];
  /** Applied and pg-access-managed, no longer declared in the config. */
  readonly orphaned: readonly PolicyChange[];
}

/**
 * Reports drift between the config and what's actually applied to a live
 * database: policies missing, policies whose expression/role drifted, and
 * pg-access-managed policies no longer declared. Net read-only - it opens
 * one transaction to let PostgreSQL normalize the config's policies for a
 * reliable comparison, then always rolls it back - but that step does need
 * a role allowed to create policies on the target tables. Fixing drift
 * means running `generate --database-url` and applying the migration.
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

  const plan = await withPgSession(connectionString, (session) => planPolicyChanges(session, auth));

  return {
    configPath,
    missing: plan.changes.filter((change) => change.kind === "create"),
    changed: plan.changes.filter((change) => change.kind === "alter"),
    orphaned: plan.changes.filter((change) => change.kind === "drop"),
  };
}
