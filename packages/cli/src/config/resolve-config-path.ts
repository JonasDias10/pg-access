import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Order matters: `.ts` first since that's the intended, type-checked way to
 * write a config, with the plain JS extensions as a fallback for projects
 * that don't want a TS toolchain at all.
 */
const CONFIG_BASENAMES = [
  "pgaccess.config.ts",
  "pgaccess.config.mts",
  "pgaccess.config.js",
  "pgaccess.config.mjs",
  "pgaccess.config.cjs",
];

/**
 * Resolves the pgaccess config file to load: an explicit `--config` path if
 * given, otherwise the first `pgaccess.config.*` found in `cwd`. Returns
 * `undefined` rather than throwing so callers can report a single,
 * consistent "no config found" error that also covers the explicit-path
 * case (a typo'd `--config` path just fails to resolve, same as no config
 * existing at all).
 */
export function resolveConfigPath(cwd: string, explicitPath?: string): string | undefined {
  if (explicitPath !== undefined) {
    const resolved = path.resolve(cwd, explicitPath);
    return existsSync(resolved) ? resolved : undefined;
  }

  for (const basename of CONFIG_BASENAMES) {
    const candidate = path.join(cwd, basename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Same as `resolveConfigPath()`, but throws a single, consistent error
 * message shared by every command that needs a config to exist before it
 * can do anything (`generate`, `check`), instead of each one re-deriving
 * its own wording for "no config found" / "explicit path doesn't exist".
 */
export function resolveConfigPathOrThrow(cwd: string, explicitPath?: string): string {
  const resolved = resolveConfigPath(cwd, explicitPath);

  if (resolved === undefined) {
    throw new Error(
      explicitPath !== undefined
        ? `Config file not found: ${explicitPath}`
        : `No pgaccess config found in ${cwd}. Expected one of: ${CONFIG_BASENAMES.join(", ")}`,
    );
  }

  return resolved;
}

export { CONFIG_BASENAMES };
