import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG_FILENAME = "pgaccess.config.ts";

const TEMPLATE = `import { and, authenticated, defineAuth, owner } from "@pg-access/core";

/**
 * Example: a \`projects\` table where anyone signed in can create a project
 * for themselves, and only the owner can see, edit, or delete their own
 * projects. Replace this with your own tables and policies, then run
 * \`pg-access generate\` to compile it into a PostgreSQL migration.
 */
export default defineAuth({
  projects: {
    rows: {
      select: owner("user_id"),
      insert: and(authenticated(), owner("user_id")),
      update: owner("user_id"),
      delete: owner("user_id"),
    },
  },
});
`;

export interface InitOptions {
  readonly cwd: string;
  readonly config?: string;
}

export interface InitResult {
  readonly filePath: string;
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const filePath = path.resolve(options.cwd, options.config ?? DEFAULT_CONFIG_FILENAME);

  if (existsSync(filePath)) {
    throw new Error(
      `${filePath} already exists. Remove it first, or pass --config to scaffold elsewhere.`,
    );
  }

  await writeFile(filePath, TEMPLATE, "utf8");

  return { filePath };
}
