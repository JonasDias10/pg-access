import { createJiti } from "jiti";
import type { AuthNode } from "@pg-access/core";

/**
 * A minimal structural check, not a full validation pass: `defineAuth()`
 * already validates the AST at definition time (see `@pg-access/core`), so
 * by the time a config's default export reaches us it's either a real,
 * already-valid `AuthNode` or something the user's config forgot to export
 * correctly. This only distinguishes those two cases.
 */
function isAuthNode(value: unknown): value is AuthNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "tables" in value &&
    Array.isArray((value as { tables: unknown }).tables)
  );
}

/**
 * Loads a `pgaccess.config.*` file and returns its default export as an
 * `AuthNode`. Uses `jiti` so `.ts` configs run directly, without requiring
 * the caller's project to have its own TypeScript execution setup.
 */
export async function loadAuthConfig(configPath: string): Promise<AuthNode> {
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const exported = await jiti.import(configPath, { default: true });

  if (!isAuthNode(exported)) {
    throw new Error(
      `${configPath} must default-export the result of defineAuth(...) from @pg-access/core, ` +
        `got ${exported === null ? "null" : typeof exported}.`,
    );
  }

  return exported;
}
