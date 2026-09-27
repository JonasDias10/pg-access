import type { PolicyChange, PolicyRef } from "@pg-access/postgres";
import path from "node:path";
import { parseArgs } from "node:util";
import { BaselineDriftError, runBaseline } from "./commands/baseline.js";
import { runCheck } from "./commands/check.js";
import { runGenerate } from "./commands/generate.js";
import { runInit } from "./commands/init.js";

const HELP = `pg-access - generate PostgreSQL RLS migrations from a pgaccess.config file

Usage:
  pg-access init [--config <path>]
  pg-access generate [--config <path>] [--out <dir>] [--format <sql|typeorm>]
                     [--database-url <url>] [--snapshot <path>]
  pg-access check [--config <path>] [--database-url <url>]
  pg-access baseline [--config <path>] [--database-url <url>] [--snapshot <path>]

Commands:
  init      Scaffold a starter pgaccess.config.ts in the current directory
  generate  Compile the config into a timestamped PostgreSQL migration,
            with only what changed since the last snapshot (or since the
            live database, with --database-url), and update the snapshot
  check     Compare the config against a live database and report drift
            (read-only; never modifies the database)
  baseline  Record the snapshot from a live database that already matches
            the config (adopting snapshots, or fixing a stale one)

Options:
  --config <path>       Path to the pgaccess config file (default:
                         auto-detected pgaccess.config.{ts,mts,js,mjs,cjs}
                         in the current directory)
  --out <dir>            Directory to write the migration into (generate
                         only, default: supabase/migrations, or
                         src/migrations for --format typeorm)
  --format <format>      Migration file to write (generate only):
                         sql (default) for a plain .sql file, or typeorm
                         for a TypeORM migration class with up() and down()
  --database-url <url>  Database to diff against (required for check and
                         baseline; optional for generate, which otherwise
                         diffs against the snapshot. Default: the
                         DATABASE_URL environment variable)
  --snapshot <path>      Snapshot file (generate and baseline only,
                         default: pgaccess.snapshot.json next to the config)
  -h, --help             Show this help message
  -v, --version          Show the CLI version
`;

async function readOwnVersion(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

function printPolicyList(policies: readonly PolicyRef[]): void {
  for (const policy of policies) {
    console.log(`  - ${policy.table}.${policy.name}`);
  }
}

function summarizeChanges(changes: readonly PolicyChange[]): string | null {
  const counts = { create: 0, alter: 0, drop: 0, noop: 0 };

  for (const change of changes) {
    counts[change.kind] += 1;
  }

  const parts: string[] = [];

  if (counts.create > 0) parts.push(`${counts.create} created`);
  if (counts.alter > 0) parts.push(`${counts.alter} altered`);
  if (counts.drop > 0) parts.push(`${counts.drop} dropped`);
  if (counts.noop > 0) parts.push(`${counts.noop} unchanged`);

  return parts.length > 0 ? parts.join(", ") : null;
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "-h" || command === "--help") {
    console.log(HELP);
    return command === undefined ? 1 : 0;
  }

  if (command === "-v" || command === "--version") {
    console.log(await readOwnVersion());
    return 0;
  }

  if (
    command !== "generate" &&
    command !== "init" &&
    command !== "check" &&
    command !== "baseline"
  ) {
    console.error(`Unknown command: ${command}\n`);
    console.log(HELP);
    return 1;
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      config: { type: "string" },
      out: { type: "string" },
      format: { type: "string" },
      "database-url": { type: "string" },
      snapshot: { type: "string" },
    },
  });

  try {
    if (command === "init") {
      const result = await runInit({ cwd: process.cwd(), config: values.config });
      console.log(`Wrote ${path.relative(process.cwd(), result.filePath)}`);
      console.log(
        "\nNext: install @pg-access/core and @pg-access/postgres, fill in your tables, then run `pg-access generate`.",
      );
      return 0;
    }

    if (command === "check") {
      const result = await runCheck({
        cwd: process.cwd(),
        config: values.config,
        databaseUrl: values["database-url"],
      });

      if (
        result.missing.length === 0 &&
        result.changed.length === 0 &&
        result.orphaned.length === 0
      ) {
        console.log("In sync: no drift between the config and the database.");
        return 0;
      }

      if (result.missing.length > 0) {
        console.log("Missing (declared in the config, not yet applied):");
        printPolicyList(result.missing);
        console.log("");
      }

      if (result.changed.length > 0) {
        console.log("Changed (applied, but the config no longer matches):");
        printPolicyList(result.changed);
        console.log("");
      }

      if (result.orphaned.length > 0) {
        console.log("Orphaned (applied to the database, no longer in the config):");
        printPolicyList(result.orphaned);
        console.log("");
      }

      console.log(
        "Run `pg-access generate --database-url <url>` and apply the resulting migration.",
      );
      return 1;
    }

    if (command === "baseline") {
      const result = await runBaseline({
        cwd: process.cwd(),
        config: values.config,
        databaseUrl: values["database-url"],
        snapshot: values.snapshot,
      });

      const snapshot = path.relative(process.cwd(), result.snapshotPath);
      console.log(
        result.snapshotWritten
          ? `Wrote ${snapshot}: the database matches the config.`
          : `${snapshot} is already up to date: the database matches the config.`,
      );
      return 0;
    }

    const result = await runGenerate({
      cwd: process.cwd(),
      config: values.config,
      out: values.out,
      format: values.format,
      databaseUrl: values["database-url"],
      snapshot: values.snapshot,
    });

    const snapshot = path.relative(process.cwd(), result.snapshotPath);

    if (result.filePath === null) {
      console.log(
        result.diffedAgainst === "database"
          ? "No changes: the database already matches the config."
          : `No changes: the config still matches ${snapshot}.`,
      );
    } else {
      console.log(`Wrote ${path.relative(process.cwd(), result.filePath)}`);

      const summary = summarizeChanges(result.changes);

      if (summary !== null) {
        console.log(summary);
      }
      if (result.diffedAgainst === "none") {
        console.log("No snapshot yet, so every policy was re-emitted.");
      }
    }

    if (result.snapshotWritten) {
      console.log(`Updated ${snapshot}`);
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    if (error instanceof BaselineDriftError) {
      console.error("");
      for (const change of error.drift) {
        console.error(`  - ${change.table}.${change.name} (${change.kind})`);
      }
    }

    return 1;
  }
}
