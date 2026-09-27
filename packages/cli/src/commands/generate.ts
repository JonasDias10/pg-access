import type { PolicyChange, PolicyChangePlan } from "@pg-access/postgres";
import {
  compile,
  planPolicyChanges,
  planSnapshotChanges,
  toMigrationFile,
} from "@pg-access/postgres";
import { toTypeOrmMigration } from "@pg-access/typeorm";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAuthConfig } from "../config/load-config.js";
import { resolveConfigPathOrThrow } from "../config/resolve-config-path.js";
import { readSnapshot, resolveSnapshotPath, writeSnapshot } from "../config/snapshot-file.js";
import { withPgSession } from "../db/with-pg-session.js";

/**
 * - `sql`: a plain `<timestamp>_pg_access.sql` file, Supabase CLI style.
 * - `typeorm`: a `<timestamp>-PgAccess.ts` migration class with `up()` and
 *   `down()`, for `typeorm migration:run` / `migration:revert`.
 */
export type MigrationFormat = "sql" | "typeorm";

export const MIGRATION_FORMATS: readonly MigrationFormat[] = ["sql", "typeorm"];

/**
 * `sql` matches Supabase CLI's own migrations directory convention. TypeORM
 * has no fixed one; `src/migrations` is what its docs and most projects use.
 */
const DEFAULT_OUT_DIR: Record<MigrationFormat, string> = {
  sql: "supabase/migrations",
  typeorm: "src/migrations",
};

interface MigrationFile {
  readonly fileName: string;
  readonly contents: string;
}

function isMigrationFormat(value: string): value is MigrationFormat {
  return (MIGRATION_FORMATS as readonly string[]).includes(value);
}

export interface GenerateOptions {
  readonly cwd: string;
  readonly config?: string;
  readonly out?: string;
  /** Migration file format to write. Defaults to `sql`. */
  readonly format?: string;
  /**
   * When given (or falling back to the DATABASE_URL environment variable),
   * the migration is diffed against that live database: unchanged policies
   * are left out entirely, drifted ones become `ALTER POLICY`, and policies
   * removed from the config are dropped. Without it, the same diff runs
   * against the snapshot instead; with no snapshot yet either, every policy
   * is re-emitted as drop-then-recreate.
   */
  readonly databaseUrl?: string;
  /** Snapshot file path. Defaults to `pgaccess.snapshot.json` next to the config. */
  readonly snapshot?: string;
  /** Overrides the clock used for the migration timestamp. Mainly for tests. */
  readonly now?: Date;
}

/**
 * - `database`: diffed against the live database (authoritative).
 * - `snapshot`: diffed against the snapshot file, no connection.
 * - `none`: no database and no snapshot yet, so every policy was re-emitted.
 */
export type DiffSource = "database" | "snapshot" | "none";

export interface GenerateResult {
  readonly configPath: string;
  /** `null` when there was nothing to change, so no migration was written. */
  readonly filePath: string | null;
  /** What was written to `filePath`: SQL, or TypeScript for `--format typeorm`. `""` when nothing was. */
  readonly contents: string;
  /**
   * The diff against the database or snapshot; empty when `diffedAgainst`
   * is `none`. Every entry is `noop` exactly when `filePath` is `null`.
   */
  readonly changes: readonly PolicyChange[];
  readonly diffedAgainst: DiffSource;
  readonly snapshotPath: string;
  /** Whether the snapshot file was created or changed. */
  readonly snapshotWritten: boolean;
}

export async function runGenerate(options: GenerateOptions): Promise<GenerateResult> {
  const format = options.format ?? "sql";

  if (!isMigrationFormat(format)) {
    throw new Error(
      `Unknown --format "${format}". Expected one of: ${MIGRATION_FORMATS.join(", ")}.`,
    );
  }

  const configPath = resolveConfigPathOrThrow(options.cwd, options.config);
  const auth = await loadAuthConfig(configPath);
  const now = options.now ?? new Date();

  const connectionString = options.databaseUrl ?? process.env["DATABASE_URL"];
  const snapshotPath = resolveSnapshotPath(options.cwd, configPath, options.snapshot);

  let plan: PolicyChangePlan;
  let diffedAgainst: DiffSource;

  if (connectionString !== undefined) {
    plan = await withPgSession(connectionString, (session) => planPolicyChanges(session, auth));
    diffedAgainst = "database";
  } else {
    const snapshot = await readSnapshot(snapshotPath);

    if (snapshot !== null) {
      plan = planSnapshotChanges(snapshot, auth);
      diffedAgainst = "snapshot";
    } else {
      // No history at all: the self-contained drop-then-recreate migration
      // is safe on any database, including one an earlier pg-access version
      // already applied policies to without a snapshot.
      const compiled = compile(auth);
      plan = {
        changes: [],
        statements: compiled.statements,
        sql: compiled.sql,
        down: compiled.down,
      };
      diffedAgainst = "none";
    }
  }

  const changes = plan.changes;
  let filePath: string | null = null;
  let contents = "";

  if (diffedAgainst === "none" || changes.some((change) => change.kind !== "noop")) {
    const migration = renderMigration(format, plan.statements, plan.down.statements, now);
    const outDir = path.resolve(options.cwd, options.out ?? DEFAULT_OUT_DIR[format]);
    filePath = path.join(outDir, migration.fileName);
    contents = migration.contents;

    await mkdir(outDir, { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }

  // Once this migration is applied (or, with no migration, already), the
  // database holds exactly what the config compiles to.
  const snapshotWritten = await writeSnapshot(snapshotPath, auth);

  return { configPath, filePath, contents, changes, diffedAgainst, snapshotPath, snapshotWritten };
}

function renderMigration(
  format: MigrationFormat,
  up: readonly string[],
  down: readonly string[],
  now: Date,
): MigrationFile {
  if (format === "typeorm") {
    const migration = toTypeOrmMigration({ up, down }, { now });
    return { fileName: migration.fileName, contents: migration.source };
  }

  // Plain SQL migrations have nowhere to put `down`.
  const migration = toMigrationFile(up.length > 0 ? `${up.join("\n\n")}\n` : "", now);
  return { fileName: migration.fileName, contents: migration.sql };
}
