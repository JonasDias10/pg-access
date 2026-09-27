import type { PolicyChange } from "@pg-access/postgres";
import { compile, planPolicyChanges, toMigrationFile } from "@pg-access/postgres";
import { toTypeOrmMigration } from "@pg-access/typeorm";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAuthConfig } from "../config/load-config.js";
import { resolveConfigPathOrThrow } from "../config/resolve-config-path.js";
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
  /** What was written to `filePath`: SQL, or TypeScript for `--format typeorm`. `""` when nothing was. */
  readonly contents: string;
  /**
   * The diff against the database, empty unless a database was given. Every
   * entry is `noop` exactly when `filePath` is `null`.
   */
  readonly changes: readonly PolicyChange[];
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

  let up: readonly string[];
  let down: readonly string[];
  let changes: readonly PolicyChange[] = [];

  if (connectionString === undefined) {
    const compiled = compile(auth);
    up = compiled.statements;
    down = compiled.down.statements;
  } else {
    const plan = await withPgSession(connectionString, (session) =>
      planPolicyChanges(session, auth),
    );

    changes = plan.changes;

    if (!changes.some((change) => change.kind !== "noop")) {
      return { configPath, filePath: null, contents: "", changes };
    }

    up = plan.statements;
    down = plan.down.statements;
  }

  const migration = renderMigration(format, up, down, now);
  const outDir = path.resolve(options.cwd, options.out ?? DEFAULT_OUT_DIR[format]);
  const filePath = path.join(outDir, migration.fileName);

  await mkdir(outDir, { recursive: true });
  await writeFile(filePath, migration.contents, "utf8");

  return { configPath, filePath, contents: migration.contents, changes };
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
