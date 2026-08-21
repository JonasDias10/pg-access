import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateMigration } from "@pg-access/postgres";
import { resolveConfigPathOrThrow } from "../config/resolve-config-path.js";
import { loadAuthConfig } from "../config/load-config.js";

/** Matches Supabase CLI's own migrations directory convention. */
const DEFAULT_OUT_DIR = "supabase/migrations";

export interface GenerateOptions {
  readonly cwd: string;
  readonly config?: string;
  readonly out?: string;
  /** Overrides the clock used for the migration timestamp. Mainly for tests. */
  readonly now?: Date;
}

export interface GenerateResult {
  readonly configPath: string;
  readonly filePath: string;
  readonly sql: string;
}

export async function runGenerate(options: GenerateOptions): Promise<GenerateResult> {
  const configPath = resolveConfigPathOrThrow(options.cwd, options.config);
  const auth = await loadAuthConfig(configPath);
  const migration = generateMigration(auth, { now: options.now });

  const outDir = path.resolve(options.cwd, options.out ?? DEFAULT_OUT_DIR);
  const filePath = path.join(outDir, migration.fileName);

  await mkdir(outDir, { recursive: true });
  await writeFile(filePath, migration.sql, "utf8");

  return { configPath, filePath, sql: migration.sql };
}
