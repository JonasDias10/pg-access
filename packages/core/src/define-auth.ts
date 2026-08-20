import type { AuthConfig } from "./ast/builders.js";
import { buildAuthNode } from "./ast/builders.js";
import type { AuthNode } from "./ast/nodes.js";
import { validate } from "./policy/policy.js";

/**
 * Turns a declarative authorization config into an AST. Fails fast on
 * structurally invalid input (e.g. an empty column name) so mistakes are
 * caught at definition time rather than at compile time.
 */
export function defineAuth(config: AuthConfig): AuthNode {
  const auth = buildAuthNode(config);
  const result = validate(auth);

  if (!result.valid) {
    const details = result.errors.map((error) => `  - [${error.path}] ${error.message}`).join("\n");
    throw new Error(`Invalid pg-access configuration:\n${details}`);
  }

  return auth;
}
