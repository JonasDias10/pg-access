import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PolicyRef } from "@pg-access/postgres";
import { diffPolicies, generateMigration } from "@pg-access/postgres";
import { fetchManagedPolicies } from "../db/fetch-managed-policies.js";
import { resolveConfigPathOrThrow } from "../config/resolve-config-path.js";
import { loadAuthConfig } from "../config/load-config.js";

/** Matches Supabase CLI's own migrations directory convention. */
const DEFAULT_OUT_DIR = "supabase/migrations";

export interface GenerateOptions {
  readonly cwd: string;
  readonly config?: string;
  readonly out?: string;
  /**
   * When given (or falling back to the DATABASE_URL environment variable),
   * the generated migration also drops managed policies applied to this
   * database that are no longer in the config. Without it, generate() only
   * knows what's in the config, not what's already applied, so it can't
   * detect a policy that was removed entirely (see @pg-access/postgres's
   * `compile()` docs on `existingPolicies`).
   */
  readonly databaseUrl?: string;
  /** Overrides the clock used for the migration timestamp. Mainly for tests. */
  readonly now?: Date;
}

export interface GenerateResult {
  readonly configPath: string;
  readonly filePath: string;
  readonly sql: string;
  /** Orphaned policies the migration drops. Empty unless a database was given. */
  readonly droppedOrphans: readonly PolicyRef[];
}

export async function runGenerate(options: GenerateOptions): Promise<GenerateResult> {
  const configPath = resolveConfigPathOrThrow(options.cwd, options.config);
  const auth = await loadAuthConfig(configPath);

  const connectionString = options.databaseUrl ?? process.env["DATABASE_URL"];
  const existingPolicies =
    connectionString === undefined
      ? undefined
      : await fetchManagedPolicies(
          connectionString,
          auth.tables.map((table) => table.name),
        );
  const droppedOrphans =
    existingPolicies === undefined ? [] : diffPolicies(auth, existingPolicies).orphaned;

  const migration = generateMigration(auth, { now: options.now, existingPolicies });

  const outDir = path.resolve(options.cwd, options.out ?? DEFAULT_OUT_DIR);
  const filePath = path.join(outDir, migration.fileName);

  await mkdir(outDir, { recursive: true });
  await writeFile(filePath, migration.sql, "utf8");

  return { configPath, filePath, sql: migration.sql, droppedOrphans };
}
