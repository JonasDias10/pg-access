import type { PolicyChange } from "@pg-access/postgres";
import { planPolicyChanges } from "@pg-access/postgres";
import { loadAuthConfig } from "../config/load-config.js";
import { resolveConfigPathOrThrow } from "../config/resolve-config-path.js";
import { resolveSnapshotPath, writeSnapshot } from "../config/snapshot-file.js";
import { withPgSession } from "../db/with-pg-session.js";

export interface BaselineOptions {
  readonly cwd: string;
  readonly config?: string;
  readonly databaseUrl?: string;
  readonly snapshot?: string;
}

export interface BaselineResult {
  readonly configPath: string;
  readonly snapshotPath: string;
  /** Whether the snapshot file was created or changed. */
  readonly snapshotWritten: boolean;
}

/** Thrown when the database doesn't match the config, carrying what differs. */
export class BaselineDriftError extends Error {
  constructor(readonly drift: readonly PolicyChange[]) {
    super(
      "The database doesn't match the config, so it can't be recorded as the snapshot. " +
        "Run `pg-access generate --database-url <url>`, apply the migration, then baseline again.",
    );
    this.name = "BaselineDriftError";
  }
}

/**
 * Re-stamps the snapshot from a live database: adopting snapshots in a
 * project whose database already has its policies, or recovering from a
 * snapshot that no longer matches it (a merge conflict, a policy changed by
 * hand and then fixed, a migration that was never applied).
 *
 * The snapshot holds `compile()` output, not what `pg_policies` reports, so
 * this doesn't copy the database into it. It checks the database matches
 * the config exactly (what `check` checks) and only then writes the
 * config's snapshot; when they differ it writes nothing and throws
 * {@link BaselineDriftError}.
 */
export async function runBaseline(options: BaselineOptions): Promise<BaselineResult> {
  const configPath = resolveConfigPathOrThrow(options.cwd, options.config);
  const auth = await loadAuthConfig(configPath);

  const connectionString = options.databaseUrl ?? process.env["DATABASE_URL"];
  if (connectionString === undefined) {
    throw new Error(
      "No database to baseline from. Pass --database-url <url> or set the DATABASE_URL environment variable.",
    );
  }

  const plan = await withPgSession(connectionString, (session) => planPolicyChanges(session, auth));
  const drift = plan.changes.filter((change) => change.kind !== "noop");

  if (drift.length > 0) {
    throw new BaselineDriftError(drift);
  }

  const snapshotPath = resolveSnapshotPath(options.cwd, configPath, options.snapshot);
  const snapshotWritten = await writeSnapshot(snapshotPath, auth);

  return { configPath, snapshotPath, snapshotWritten };
}
