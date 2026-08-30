import type { Migration, PolicyChange } from "@pg-access/postgres";
import { generateMigration, planPolicyChanges, toMigrationFile } from "@pg-access/postgres";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAuthConfig } from "../config/load-config.js";
import { resolveConfigPathOrThrow } from "../config/resolve-config-path.js";
import { withPgSession } from "../db/with-pg-session.js";

/** Matches Supabase CLI's own migrations directory convention. */
const DEFAULT_OUT_DIR = "supabase/migrations";

export interface GenerateOptions {
  readonly cwd: string;
  readonly config?: string;
  readonly out?: string;
  /**
   * When given (or falling back to the DATABASE_URL environment variable),
   * the migration is diffed against that live database: unchanged policies
   * are left out entirely, drifted ones become `ALTER POLICY`, and policies
   * removed from the config are dropped. Without it, generate() only knows
   * the config and re-emits every policy as drop-then-recreate.
   */
  readonly databaseUrl?: string;
  /** Overrides the clock used for the migration timestamp. Mainly for tests. */
  readonly now?: Date;
}

export interface GenerateResult {
  readonly configPath: string;
  /** `null` when a database was given and nothing had drifted, so no file was written. */
  readonly filePath: string | null;
  readonly sql: string;
  /**
   * The diff against the database, empty unless a database was given. Every
   * entry is `noop` exactly when `filePath` is `null`.
   */
  readonly changes: readonly PolicyChange[];
}

export async function runGenerate(options: GenerateOptions): Promise<GenerateResult> {
  const configPath = resolveConfigPathOrThrow(options.cwd, options.config);
  const auth = await loadAuthConfig(configPath);
  const now = options.now ?? new Date();

  const connectionString = options.databaseUrl ?? process.env["DATABASE_URL"];

  let migration: Migration;
  let changes: readonly PolicyChange[] = [];

  if (connectionString === undefined) {
    migration = generateMigration(auth, { now });
  } else {
    const plan = await withPgSession(connectionString, (session) =>
      planPolicyChanges(session, auth),
    );

    changes = plan.changes;

    if (!changes.some((change) => change.kind !== "noop")) {
      return { configPath, filePath: null, sql: "", changes };
    }

    migration = toMigrationFile(plan.sql, now);
  }

  const outDir = path.resolve(options.cwd, options.out ?? DEFAULT_OUT_DIR);
  const filePath = path.join(outDir, migration.fileName);

  await mkdir(outDir, { recursive: true });
  await writeFile(filePath, migration.sql, "utf8");

  return { configPath, filePath, sql: migration.sql, changes };
}
