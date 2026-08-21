export { compile } from "./compiler/compiler.js";
export type { CompileOptions, CompileResult } from "./compiler/compiler.js";

export { compileExpression } from "./compiler/expressions.js";

export {
  compilePolicy,
  policyName,
  renderCreatePolicy,
  renderDropPolicyIfExists,
} from "./compiler/policies.js";
export type { CompiledPolicy } from "./compiler/policies.js";

export { quoteIdent, quoteLiteral, quoteRole } from "./compiler/identifiers.js";

export { postgresDialect } from "./dialect/postgres.js";
export type { Dialect } from "./dialect/postgres.js";

export { generateMigration } from "./migrations/generator.js";
export type { Migration, MigrationOptions } from "./migrations/generator.js";

export { listManagedPolicies } from "./introspect/list-managed-policies.js";
export type { ManagedPolicy, PgQueryable } from "./introspect/list-managed-policies.js";

export { diffPolicies } from "./diff/diff-policies.js";
export type { PolicyDiffResult, PolicyRef } from "./diff/diff-policies.js";
