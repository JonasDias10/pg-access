import type { AuthNode } from "@pg-access/core";
import type { PolicySnapshot } from "@pg-access/postgres";
import { createSnapshot, parseSnapshot, serializeSnapshot } from "@pg-access/postgres";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_SNAPSHOT_FILENAME = "pgaccess.snapshot.json";

/**
 * An explicit `--snapshot` path resolves against `cwd`, like `--config`.
 * Otherwise the snapshot sits next to the config it snapshots, so both are
 * committed together and a monorepo with several configs gets one each.
 */
export function resolveSnapshotPath(
  cwd: string,
  configPath: string,
  explicitPath?: string,
): string {
  return explicitPath !== undefined
    ? path.resolve(cwd, explicitPath)
    : path.join(path.dirname(configPath), DEFAULT_SNAPSHOT_FILENAME);
}

/** `null` when there's no snapshot yet; throws (with the path) when there is one but it can't be read. */
export async function readSnapshot(snapshotPath: string): Promise<PolicySnapshot | null> {
  let text: string;

  try {
    text = await readFile(snapshotPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  try {
    return parseSnapshot(text);
  } catch (error) {
    throw new Error(
      `${snapshotPath}: ${(error as Error).message} ` +
        "Fix or delete it, or rebuild it from a database with `pg-access baseline`.",
      { cause: error },
    );
  }
}

/**
 * Writes the snapshot of `auth`, skipping the write when the file already
 * holds exactly that, so an unchanged snapshot never shows up as modified.
 * Returns whether it wrote.
 */
export async function writeSnapshot(snapshotPath: string, auth: AuthNode): Promise<boolean> {
  const contents = serializeSnapshot(createSnapshot(auth));
  const current = await readFile(snapshotPath, "utf8").catch(() => null);

  if (current === contents) {
    return false;
  }

  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, contents, "utf8");
  return true;
}
