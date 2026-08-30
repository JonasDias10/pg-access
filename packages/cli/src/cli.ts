import type { PolicyChange, PolicyRef } from "@pg-access/postgres";
import path from "node:path";
import { parseArgs } from "node:util";
import { runCheck } from "./commands/check.js";
import { runGenerate } from "./commands/generate.js";
import { runInit } from "./commands/init.js";

const HELP = `pg-access - generate PostgreSQL RLS migrations from a pgaccess.config file

Usage:
  pg-access init [--config <path>]
  pg-access generate [--config <path>] [--out <dir>] [--database-url <url>]
  pg-access check [--config <path>] [--database-url <url>]

Commands:
  init      Scaffold a starter pgaccess.config.ts in the current directory
  generate  Compile the config into a timestamped PostgreSQL migration
  check     Compare the config against a live database and report drift
            (read-only; never modifies the database)

Options:
  --config <path>       Path to the pgaccess config file (default:
                         auto-detected pgaccess.config.{ts,mts,js,mjs,cjs}
                         in the current directory)
  --out <dir>            Directory to write the migration into (generate
                         only, default: supabase/migrations)
  --database-url <url>  Database to diff against (required for check;
                         optional for generate, to emit only what drifted -
                         ALTER for changed policies, DROP for removed ones,
                         nothing for unchanged. Default: the DATABASE_URL
                         environment variable)
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

  if (command !== "generate" && command !== "init" && command !== "check") {
    console.error(`Unknown command: ${command}\n`);
    console.log(HELP);
    return 1;
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      config: { type: "string" },
      out: { type: "string" },
      "database-url": { type: "string" },
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

    const result = await runGenerate({
      cwd: process.cwd(),
      config: values.config,
      out: values.out,
      databaseUrl: values["database-url"],
    });

    if (result.filePath === null) {
      console.log("No changes: the database already matches the config.");
      return 0;
    }

    console.log(`Wrote ${path.relative(process.cwd(), result.filePath)}`);

    const summary = summarizeChanges(result.changes);

    if (summary !== null) {
      console.log(summary);
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
